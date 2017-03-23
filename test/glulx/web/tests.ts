// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/


import { Test } from '../../nodeunit'

import { g, GlulxFunction } from '../../../src/glulx/ast'
import { module } from '../../../src/glulx/module'
import { BufferedEmitter } from '../../../src/emit'
import { decodeOpcode, decodeFunction } from '../../../src/glulx/decoder'
import { DummyGLK, OutputBuffer } from '../../../src/glulx/glk'
import { strRepr } from '../../../src/repr'
import { VmLibSupport, GlulxAccess } from '../../../src/glulx/host'

declare var WebAssembly: any

const var0 = g.localVariable(0)

const ramStart = 10
const image = new Uint8Array([
    // ROM
    1, 1, 2, 3, 5, 8, 13, 21, 34, 55,
    // RAM
    0x42, 0, 0x42, 0, 42, 0, 42, 0
])

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
        g.function_i32_i32(addr++, "jne", [
            g.jne(g.const_(2), var0, g.const_(1)),
            g.return_(var0)
        ]),
        42, 1,
        1, 1,
        2, 2,
        3, 1
    ],
    [
        g.function_i32_i32(addr++, "read from ROM", [
            g.return_(g.memory(0))
        ]),
        0, 0x01010203,  // big endian
    ],
    [
        g.function_i32_i32(addr++, "read from RAM", [
            g.return_(g.memory(ramStart))
        ]),
        0, 0x42004200,  // big endian
    ],
    [
        g.function_i32_i32(addr++, "write to RAM", [
            g.copy(var0, g.storeToMemory(ramStart)),
            g.return_(g.memory(ramStart))
        ]),
        99, 99,
        88, (test: Test, x) => {
            test.equals(glulx.getMemory()[ramStart], 0, "read updated RAM")
            test.equals(glulx.getMemory()[ramStart + 3], 88, "read updated RAM")
            test.equals(x, 88, "return value")
        }
    ],
    [
        g.function_i32_i32(addr++, "callf", [
            g.callf(g.const_(0), [var0], g.setLocalVariable(0)),
            g.return_(var0)
        ]),
        1, 2,
        0, 1,
        -1, 0
    ],
    [
        g.function_i32_i32(addr++, "push/pop", [
            g.add(var0, var0, g.push),
            g.return_(g.pop)
        ]),
        1, 2,
        -1, -2,
        21, 42
    ],
    [
        g.function_i32_i32(addr++, "glk_put_char",
            g.glk.put_char(var0).concat(
                g.return_(var0)
            )),
        65, (test: Test, x) => test.equals(OutputBuffer, "A", "output A"),
        66, (test: Test, x) => test.equals(OutputBuffer, "AB", "output AB"),
        67, (test: Test, x) => test.equals(OutputBuffer, "ABC", "output ABC"),
    ]
]

let glulx: GlulxAccess = null

const vmlib_support: VmLibSupport = {
    glk(selector, argc) {
        return glulx.glk(selector, argc)
    }
}

const mod = module(cases.map(c => c[0]), image, ramStart, image.byteLength)
const buffer = new ArrayBuffer(32000)
const emitter = new BufferedEmitter(buffer)
mod.emit(emitter)

const wasm = WebAssembly.instantiate(new Uint8Array(buffer, 0, emitter.length), { vmlib_support })

export const tests: any = {}
cases.forEach(c => {
    const f = c[0]
    tests[f.name] = (test: Test) => runCase(test, f.name, c)
})

function runCase(test: Test, name: string, data: any[]) {
    wasm.then(module => {
        glulx = new GlulxAccess(module.instance, DummyGLK)
        const func = module && module.instance && module.instance.exports && module.instance.exports[name]
        test.ok(func, "compiled function was found in exports")
        for (let i = 1; i < data.length; i += 2) {
            let input = data[i]
            let expected = data[i + 1]
            let result = func(input)
            if (expected.call) {
                expected.call(null, test, result)
            } else {
                test.equals(result, expected, input + " -> " + expected + ", got " + result)
            }
        }
        test.done()
    })
}


