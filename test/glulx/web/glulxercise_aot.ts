// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/


import { Test } from '../../nodeunit'

import { DummyGLK, OutputBuffer, ClearOutputBuffer } from '../../../src/glulx/glk'
import { GlulxAccess, VmLibSupport } from '../../../src/glulx/host'

import { test_cases } from './glulxercise_cases'


declare var WebAssembly: any

const wasm = fetch('build/glulxercise.wasm')
    .then(response => response.arrayBuffer())
    .then(bytes => WebAssembly.instantiate(bytes, { vmlib_support }))


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

function runCase(test: Test, name: string, data: any[]) {
    wasm.then(module => {
        glulx = new GlulxAccess(module.instance, DummyGLK)

        const func = module && module.instance && module.instance.exports && module.instance.exports[name]

        test.ok(func, "compiled function was found in exports")
        if (func) for (let i = 1; i < data.length; i += 3) {
            let input = data[i]
            if (!input.slice) input = [input]
            ClearOutputBuffer()
            let expected = data[i + 1]
            let expectedOutput = data[i + 2]
            try {
                let result = func.apply(null, input)
                if (expected.call) {
                    expected.call(null, test, result)
                } else {
                    if (expectedOutput === null) {
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


tests["load ahead-of-time compiled WASM"] = (test: Test) => {
    wasm.then(module => {
        const exp = module.instance.exports
        test_cases.forEach(c => test.ok(exp[c[0].name], "exported function " + c[0].name))
        test.done()
    })
}

test_cases.forEach(c => {
    const name = c[0]
    tests[name] = (test: Test) => runCase(test, name, c)
})
