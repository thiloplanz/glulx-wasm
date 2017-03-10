// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/


import { Test } from '../../nodeunit'

import { g, GlulxFunction } from '../../../src/glulx/ast'
import { module } from '../../../src/glulx/module'
import { BufferedEmitter } from '../../../src/emit'
import { decodeOpcode, decodeFunction } from '../../../src/glulx/decoder'

declare var WebAssembly: any

const var0 = g.localVariable(0)

const rom = new Uint8Array([1, 1, 2, 3, 5, 8, 13, 21, 34, 55])

let addr = 0;

const cases: any[] = [
    [   // function body
        g.function_i32_i32(addr++, "return_input_plus_one", [
            g.add(var0, g.const_(1), g.setLocalVariable(0)),
            g.return_(var0)]),
        // input and expected output    
        1, 2,
        0, 1,
        -1, 0
    ],
    [
        g.function_i32_i32(addr++, "return_constant", [
            g.return_(g.const_(42))
        ]),
        99, 42
    ],
    [
        g.function_i32_i32(addr++, "jump 2 (nop)", [
            g.jump(g.const_(2)),
            g.return_(var0)
        ]),
        42, 42
    ],
    [
        g.function_i32_i32(addr++, "read from ROM", [
            g.return_(g.memory(0))
        ]),
        0, 0x01010203,  // big endian
    ],
    [
        g.function_i32_i32(addr++, "callf", [
            g.callf(g.const_(0), [var0], g.setLocalVariable(0)),
            g.return_(var0)
        ]),
        1, 2,
        0, 1,
        -1, 0
    ]
]

const mod = module(cases.map(c => c[0]), rom)
const buffer = new ArrayBuffer(32000)
const emitter = new BufferedEmitter(buffer)
mod.emit(emitter)
const wasm = WebAssembly.instantiate(new Uint8Array(buffer, 0, emitter.length))

export const tests: any = {}
cases.forEach(c => {
    const f = c[0]
    tests[f.name] = (test: Test) => runCase(test, f.name, c)
})

function runCase(test: Test, name: string, data: any[]) {
    wasm.then(module => {
        const func = module && module.instance && module.instance.exports && module.instance.exports[name]
        test.ok(func, "compiled function was found in exports")
        for (let i = 1; i < data.length; i += 2) {
            let input = data[i]
            let expected = data[i + 1]
            let result = func(input)
            test.equals(result, expected, input + " -> " + expected + ", got " + result)
        }
        test.done()
    })
}


