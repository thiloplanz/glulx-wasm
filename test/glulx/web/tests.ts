// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/


import {Test} from '../../nodeunit'
     
import {g} from '../../../src/glulx/ast'
import {c} from '../../../src/ast'
import { strRepr } from '../../../src/repr'
import { BufferedEmitter} from '../../../src/emit'


declare var WebAssembly : any

const {type_section, func_type, i32, function_section,
    varuint32, export_section, export_entry, 
    str_ascii, external_kind, code_section, function_body,
    get_global, get_local, call, if_
  } = c
  
const var0 = g.localVariable(0)

const mod = c.module([

  type_section([
    func_type([i32], i32), // type index = 0
  ]),

  function_section([
    varuint32(0), // function index = 0, using type index 0
  ]),

  export_section([
    // exports "factorial" as function at index 0
    export_entry(str_ascii("test_return_input_plus_one"), external_kind.function, varuint32(0)),
  ]),

  code_section([
    // body of function at index 0:
    g.function_body([
      g.add(var0, g.const_(1), g.setLocalVariable(0)),
      g.return_(g.localVariable(0))
    ])]
  )]
)


export const tests = {
    return_input_plus_one(test:Test){ 
        const buffer = new ArrayBuffer(10000)
        const emitter = new BufferedEmitter(buffer)
        mod.emit(emitter)
        WebAssembly.instantiate(new Uint8Array(buffer, 0, emitter.length)).then( module => {
            const instance = module.instance
            test.equals(instance.exports.test_return_input_plus_one(1), 2)
            test.equals(instance.exports.test_return_input_plus_one(0), 1)
            test.equals(instance.exports.test_return_input_plus_one(-1), 0)
        
            test.done()
        }) 
    }
}

