// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/


import { Test } from '../../nodeunit'

import { g, GlulxFunction } from '../../../src/glulx/ast'
import { module } from '../../../src/glulx/module'
import { BufferedEmitter } from '../../../src/emit'
import { decodeOpcode } from '../../../src/glulx/decoder'

declare var WebAssembly: any

const var0 = g.localVariable(0)

const cases:　any[] = [
    [   // function body
            g.function_i32_i32("return_input_plus_one", [
                g.add(var0, g.const_(1), g.setLocalVariable(0)),
                g.return_(g.localVariable(0))]),
            // input and expected output    
            1, 2,
            0, 1,
            -1, 0
        ],
        [
            g.function_i32_i32("return_constant", [
                g.return_(g.const_(42))
            ]),
            99, 42
        ],
]

const glulxercise_cases : any[][] = [
        [
            "__0x0012f7__add_03_fc_Fr00",
            glulxercise => g.function_i32_i32("dummy", [
                decodeOpcode(glulxercise, 0x00012f7).v,  // add  03 fc Fr:00
                g.return_(var0)
            ]),
            88, 0xff,
        ]
]

const gluxercise: Promise<any[][]> = new Promise(function(resolve, reject) {
    let request = new XMLHttpRequest();
	request.open("GET", "../glulxercise.ulx");
	request.responseType = 'arraybuffer';
	request.onload = function(){
	    if (request.status == 200){
            const image = new Uint8Array(request.response)
            resolve(glulxercise_cases.map(c => { 
                const name = c.shift()
                c[0] = c[0](image)
                c[0].name = name
                return c
            }))
        } else {
            console.warn("Failed to load the glulxercise image", request.statusText)
            resolve([])
        }
    }
    request.onerror = function() {
         console.error('There was a network error. Could not load the glulxercise image');
         resolve([])
    }
    
    request.send()
})


let wasm: Promise<any> = gluxercise.then( moreCases => {
    const all = cases.concat(moreCases)
    const mod = module(all.map(c => c[0]))
    const buffer = new ArrayBuffer(10000)
    const emitter = new BufferedEmitter(buffer)
    mod.emit(emitter)
    return WebAssembly.instantiate(new Uint8Array(buffer, 0, emitter.length))
})

export const tests: any = {}

function runCase(test: Test, name: string, data: any[]) {
    wasm.then(module => {
        for (let i = 1; i < data.length; i += 2) {
            let input = data[i]
            let expected = data[i + 1]
            let result = module.instance.exports[name](input)
            test.equals(result, expected, input + " -> " + expected + " , but got " + result)
        }
        test.done()
    })
}

cases.concat(glulxercise_cases).forEach(c => {
    const f = c[0]
    tests[f.name || f] = (test: Test) => runCase(test, f.name || f, c)
})

tests.compile_test_module = (test: Test) => {
    wasm.then((module) => {
        const exp = module.instance.exports
        cases.forEach(c => test.ok(exp[c[0].name], "exported function " + c[0].name))
        test.done()
    })

}
