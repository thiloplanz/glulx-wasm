// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/


// Functions to transform Glulx AST into WASM modules

import {g, Opcode, GlulxFunction, function_type_i32, function_type_no_args} from './ast'
import {Module, c, FunctionBody} from '../ast'

const {
    function_section, export_section, code_section, func_type, i32, varuint32, export_entry, str_ascii,
    external_kind
} = c

const var0 = g.localVariable(0)

const type_section = c.type_section([function_type_i32, function_type_no_args])
const type_i32_i32 = varuint32(0) 
const type_i32 = varuint32(1)

function function_body(opcodes: Opcode[]): FunctionBody { 
    return c.function_body([ /* additional local variables here */ ], opcodes.map(o => o.transcode())) 
}

export function module(functions: GlulxFunction[]): Module {
    return c.module([
        type_section,
        function_section( functions.map(f => {
            if (f.type == function_type_i32) return type_i32_i32
            if (f.type == function_type_no_args) return type_i32
            console.error(f)
            console.error(f.type)
            throw new Error(`unsupported function type ${f.type}`)
        })),

        export_section( functions.map((f, i) => 
            export_entry(str_ascii(f.name), external_kind.function, varuint32(i)),
        )),

        code_section( functions.map( f => function_body( f.opcodes ) ))
    ])
} 