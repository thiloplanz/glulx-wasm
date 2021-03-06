// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/


import { Test } from '../../nodeunit'

import { g, GlulxFunction, GlkCall } from '../../../src/glulx/ast'
import { module } from '../../../src/glulx/module'
import { BufferedEmitter } from '../../../src/emit'
import { decodeOpcode, decodeFunction } from '../../../src/glulx/decoder'
import { DummyGLK, OutputBuffer, ClearOutputBuffer } from '../../../src/glulx/glk'
import { strRepr } from '../../../src/repr'
import { VmLibSupport, GlulxAccess } from '../../../src/glulx/host'

declare var WebAssembly: any

const var0 = g.localVariable(0)
const var1 = g.localVariable(4)

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
        g.function_i32_i32(addr++, "aloadbit", [
            g.aloadbit(g.const_(0), var0, g.setLocalVariable(0)),
            g.return_(var0)
        ]),
        0, 1,
        1, 0,
        16, 0,
        17, 1,
        81, 1
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
            g.add(var0, var0, g.push),   // push two, pop one, leaves one on the stack
            g.add(var0, var0, g.push),
            g.return_(g.pop)
        ]),
        1, 2,
        -1, -2,
        21, 42
    ],
    [
        g.function_i32_i32(addr++, "call frame removed from stack upon return", [
            g.copy(g.const_(42), g.push),
            g.callf(g.const_(addr - 2), [var0], g.discard),
            g.return_(g.pop)
        ]),
        1, 42,
        -1, 42
    ],
    [
        g.function_i32_i32(addr++, "glk_put_char",
            g.glk.put_char(var0).concat(
                g.return_(var0)
            )),
        65, (test: Test, x) => checkOutput(test, "A"),
        66, (test: Test, x) => checkOutput(test, "B"),
        67, (test: Test, x) => checkOutput(test, "C")
    ],
    [
        g.function_i32_i32_i32(addr++, "glk_call_1_arg", [
            g.copy(var1, g.push),
            new GlkCall(var0, g.const_(1), g.push),
            g.return_(g.pop)]),
        [0x80, 88], (test: Test, x) => checkOutput(test, "X")  // 0x80 = put_char, 88 = X
    ],
    [
        g.function_i32_i32(addr++, "glk_put_buffer",
            g.glk.put_buffer(var0, g.const_(2)).concat(
                g.return_(var0)
            )),
        8, (test: Test, x) => checkOutput(test, '"7')
    ],
    [
        g.function_i32_i32(addr++, "streamnum", [
            g.setiosys(g.const_(2), g.const_(0)),
            g.streamnum(var0),
            g.return_(var0)
        ]),
        0, (test: Test, x) => checkOutput(test, "0"),
        1, (test: Test, x) => checkOutput(test, "1"),
        9, (test: Test, x) => checkOutput(test, "9"),
        10, (test: Test, x) => checkOutput(test, "10"),
        -1, (test: Test, x) => checkOutput(test, "-1"),
        1234, (test: Test, x) => checkOutput(test, "1234"),
    ]
]

function checkOutput(test: Test, expected: string) {
    if (expected != OutputBuffer) {
        console.error("unexpected OutputBuffer", expected, OutputBuffer)
    }
    test.equals(OutputBuffer, expected, "Output " + expected)
}

let glulx: GlulxAccess = null

const vmlib_support: VmLibSupport = {
    glk(selector, argc) {
        return glulx.glk(selector, argc)
    }
}

const mod = module(cases.map(c => c[0]), image, ramStart, image.byteLength, 0x00)
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
            if (!input.slice) input = [input]
            let expected = data[i + 1]
            ClearOutputBuffer()
            try {
                let result = func.apply(null, input)
                if (expected.call) {
                    expected.call(null, test, result)
                } else {
                    test.equals(result, expected, input + " -> " + expected + ", got " + result)
                }
            } catch (e) {
                test.ifError(e)
            }
        }
        test.done()
    })
}


