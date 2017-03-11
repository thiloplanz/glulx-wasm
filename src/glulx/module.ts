// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/


// Functions to transform Glulx AST into WASM modules

import { g, Opcode, GlulxFunction, TranscodingContext, function_type_i32, function_type_no_args } from './ast'
import { Module, c, FunctionBody, VarUint32 } from '../ast'
import { uint32 } from '../basic-types'

const {
    function_section, export_section, code_section, func_type, i32, varuint32, export_entry, str_ascii,
    external_kind, memory_section, data_section, data_segment, resizable_limits, init_expr, data
} = c

const var0 = g.localVariable(0)

const zero = varuint32(0)
const type_section = c.type_section([function_type_i32, function_type_no_args])
const type_i32_i32 = zero
const type_i32 = varuint32(1)

function function_body(opcodes: Opcode[], context: TranscodingContext): FunctionBody {
    return c.function_body([ /* additional local variables here */], opcodes.map(o => o.transcode(context)))
}

export function module(functions: GlulxFunction[], image: Uint8Array, ramStart: uint32, endMem: uint32): Module {
    const memoryPages = varuint32(image.byteLength / (64 * 1024) + 1)
    const functionIndex: VarUint32[] = []
    functions.forEach((f, i) => functionIndex[f.address] = varuint32(i))


    const function_sec = function_section(functions.map(f => {
        if (f.type == function_type_i32) return type_i32_i32
        if (f.type == function_type_no_args) return type_i32
        console.error(f)
        console.error(f.type)
        throw new Error(`unsupported function type ${f.type}`)
    }))

    const export_sec = export_section(functions.map(f =>
        export_entry(str_ascii(f.name), external_kind.function, functionIndex[f.address]),
    ))


    const data_sec = data_section([data_segment(zero, init_expr([c.i32.const(0)]), data(image))])

    return c.module([
        type_section,
        function_sec,
        memory_section([resizable_limits(memoryPages, memoryPages)]),
        export_sec,
        code_section(functions.map(f => function_body(f.opcodes, {
            callableFunctions: functionIndex,
            image,
            ramStart,
            endMem
        }))),
        data_sec
    ])
} 