// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/


import { Test } from '../../nodeunit'

import { g, GlulxFunction } from '../../../src/glulx/ast'
import { module } from '../../../src/glulx/module'
import { BufferedEmitter } from '../../../src/emit'
import { decodeOpcode, decodeFunction } from '../../../src/glulx/decoder'
import { DummyGLK, OutputBuffer, ClearOutputBuffer } from '../../../src/glulx/glk'
import { GlulxAccess, VmLibSupport } from '../../../src/glulx/host'

import { test_cases } from './glulxercise_cases'

let image: Uint8Array

const gluxercise: Promise<any[][]> = new Promise(function (resolve, reject) {
    let request = new XMLHttpRequest();
    request.open("GET", "../glulxercise.ulx");
    request.responseType = 'arraybuffer';
    request.onload = function () {
        if (request.status == 200) {
            image = new Uint8Array(request.response)
            resolve(cases.map(c => {
                const name = c.shift()
                try {
                    if (c[0].apply) {
                        c[0] = c[0](image)
                    }
                    else {
                        c[0] = decodeFunction(image, c[0]).v
                    }
                    c[0].name = name
                } catch (e) {
                    console.warn("failed to compile " + name, e)
                    c[0] = { failed: true, name: name }
                }
                return c
            }))
        } else {
            console.warn("Failed to load the glulxercise image", request.statusText)
            resolve([])
        }
    }
    request.onerror = function () {
        console.error('There was a network error. Could not load the glulxercise image');
        resolve([])
    }

    request.send()
})

const wasm: Promise<any> = gluxercise.then(cases => {
    const mod = module(cases.map(c => c[0]).filter(x => !x.failed), image, 0x00027600, 0x0002b200, 0x0001c9a6)
    const buffer = new ArrayBuffer(1024 * 1024)
    const emitter = new BufferedEmitter(buffer)
    mod.emit(emitter)
    return WebAssembly.instantiate(new Uint8Array(buffer, 0, emitter.length), { vmlib_support })
})

let addr = 0;
const cases: any[][] = [
    [
        "_0x000012f7__add_03_fc_Fr00",
        glulxercise => g.function_i32_i32(addr++, null, [
            decodeOpcode(glulxercise, 0x00012f7).v,  // add  03 fc Fr:00
            g.return_(g.localVariable(0))
        ]),
        88, 0xff, null
    ],
    [
        "decode_compressed_string_1d279",
        gluxercise => g.function_i32_i32(addr++, null, [
            g.streamstr(g.const_(0x0001d279)),
            g.return_(g.localVariable(0))
        ]),
        0, 0, "Nothing happens."
    ],
    [
        "callfii_stack_function_0x1x981",
        gluxercise => g.function_i32_i32_i32(addr++, null, [
            g.callf(g.const_(0x1c981), [g.localVariable(0), g.localVariable(4)], g.discard),
            g.return_(g.localVariable(4))
        ]),
        [0x80, 88], 88, "X"  // 0x80 = glk_putchar, 88 => X
    ]
].concat(test_cases)


function checkOutput(test: Test, expected: string, returnValue: number, expectedReturnValue: number) {
    if (expected != OutputBuffer) {
        console.error("unexpected OutputBuffer", expected, OutputBuffer)
    }
    test.equals(OutputBuffer, expected, "Output " + expected)
    test.equals(returnValue, expectedReturnValue, "Return value: " + returnValue + ", expected " + expectedReturnValue)
}

export const tests: any = {}

let glulx: GlulxAccess = null

const vmlib_support: VmLibSupport = {
    glk(selector, argc) {
        return glulx.glk(selector, argc)
    }
}

declare var WebAssembly: any

function runCase(test: Test, name: string, data: any[]) {
    wasm.then(module => {
        glulx = new GlulxAccess(module.instance, DummyGLK)

        const func = module && module.instance && module.instance.exports && module.instance.exports[name]
        const stackCalled = name.startsWith("stackCalled_")

        test.ok(func, "compiled function was found in exports")
        if (func) for (let i = 1; i < data.length; i += 3) {
            let input = data[i]
            if (!input.slice) input = [input]
            let expected = data[i + 1]
            let expectedOutput = data[i + 2]
            try {
                if (expectedOutput !== null) {
                    // turn on GLK
                    module.instance.exports["_0x0000a022__setiosys"](88)
                }
                ClearOutputBuffer()
                let result = stackCalled ? glulx.callStackCalledFunction(func, input) : func.apply(null, input)

                if (expected.call) {
                    expected.call(null, test, result)
                } else {
                    if (expectedOutput === null) {
                        console.info(input, expected, result, func)
                        test.equals(result, expected, input + " -> " + expected + ", got " + result)
                    } else {
                        checkOutput(test, expectedOutput, result, expected)
                    }
                }
            }
            catch (e) {
                test.ifError(e)
            }
        }
        test.done()
    })
}


tests["compile test module from glulxercise image"] = (test: Test) => {
    wasm.then(module => {
        window['mooo'] = module

        const exp = module.instance.exports
        cases.forEach(c => test.ok(exp[c[0].name], "exported function " + c[0].name))

        test.done()
    })
}



cases.forEach(c => {
    const name = c[0]
    tests[name] = (test: Test) => runCase(test, name, c)
})
