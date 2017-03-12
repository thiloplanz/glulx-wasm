// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/


import { Test } from '../../nodeunit'

import { g, GlulxFunction } from '../../../src/glulx/ast'
import { module } from '../../../src/glulx/module'
import { BufferedEmitter } from '../../../src/emit'
import { decodeOpcode, decodeFunction } from '../../../src/glulx/decoder'
import { DummyGLK } from '../../../src/glulx/glk'
import { GlulxAccess, VmLibSupport } from '../../../src/glulx/host'


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
                    c[0] = c[0](image)
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
    const mod = module(cases.map(c => c[0]).filter(x => !x.failed), image, 0x00027600, 0x0002b200)
    const buffer = new ArrayBuffer(1024 * 1024)
    const emitter = new BufferedEmitter(buffer)
    mod.emit(emitter)
    return WebAssembly.instantiate(new Uint8Array(buffer, 0, emitter.length), { vmlib_support })
})


const cases: any[][] = [
    [
        "_0x000012f7__add_03_fc_Fr00",
        glulxercise => g.function_i32_i32(0, null, [
            decodeOpcode(glulxercise, 0x00012f7).v,  // add  03 fc Fr:00
            g.return_(g.localVariable(0))
        ]),
        88, 0xff,
    ],
    [
        "_0x0000707c__return false",
        gluxercise => decodeFunction(gluxercise, 0x707c).v,
        [], 0
    ],
    [
        "_0x00007084__return true",
        gluxercise => decodeFunction(gluxercise, 0x7084).v,
        [], 1
    ],
    [
        "_0x0000708d__return input",
        gluxercise => decodeFunction(gluxercise, 0x708d).v,
        0, 0,
        1, 1
    ],
    [
        "_0x00007098__return false",
        gluxercise => decodeFunction(gluxercise, 0x7098).v,
        0, 0,
        1, 0
    ],
    [
        "_0x000070a6__return true",
        gluxercise => decodeFunction(gluxercise, 0x70a6).v,
        0, 1,
        1, 1
    ],
    [
        "_0x000070b5__jump_table",
        gluxercise => decodeFunction(gluxercise, 0x70b5).v,
        0, 0,
        1, 1,
        2, 2,
        5, 3
    ],
    [
        "_0x000070eb__jz",
        gluxercise => decodeFunction(gluxercise, 0x70eb).v,
        0, 0,
        1, 99
    ],
    [
        "_0x000070f6__jz",
        gluxercise => decodeFunction(gluxercise, 0x70f6).v,
        0, 1,
        42, 99
    ],


]


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

        test.ok(func, "compiled function was found in exports")
        if (func) for (let i = 1; i < data.length; i += 2) {
            let input = data[i]
            let expected = data[i + 1]
            try {
                let result = func(input)
                test.equals(result, expected, input + " -> " + expected + ", got " + result)
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
        const exp = module.instance.exports
        cases.forEach(c => test.ok(exp[c[0].name], "exported function " + c[0].name))

        test.done()
    })
}

cases.forEach(c => {
    const name = c[0]
    tests[name] = (test: Test) => runCase(test, name, c)
})
