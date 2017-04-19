// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/


// Functions to transform Glulx AST into WASM modules

import { g, Opcode, GlulxFunction, TranscodingContext } from './ast'
import { global_section, types, vmlib, vmlib_function_types, vmlib_imports, type_section, vmlib_function_index } from './vmlib'

import { Module, c, FunctionBody, VarUint32, I32, LocalEntry } from '../ast'
import { uint32 } from '../basic-types'

const {
    function_section, export_section, code_section, func_type, i32, varuint32, export_entry, str_ascii,
    external_kind, memory_section, data_section, data_segment, resizable_limits, init_expr, data,
    import_section
} = c

const var0 = g.localVariable(0)

const zero = varuint32(0)
const i32_zero = c.i32.const(0)

function function_body(opcodes: Opcode[], context: TranscodingContext, extraLocals: LocalEntry[] = []): FunctionBody {
    return c.function_body(extraLocals, opcodes.map(o => o.transcode(context)))
}

export function module(functions: GlulxFunction[], image: Uint8Array, ramStart: uint32, endMem: uint32, stringTbl: uint32): Module {

    const heapSize = 0  // TODO
    const stackStart = endMem + heapSize

    const memoryPages = varuint32(image.byteLength / (64 * 1024) + 1)
    const functionIndex: VarUint32[] = []
    const stackCalledFunctions: boolean[] = []
    functions.forEach((f, i) => {
        functionIndex[f.address] = varuint32(i + vmlib_imports.length + vmlib_function_types.length)
        if (f.stackCalled) stackCalledFunctions[f.address] = true
    })

    const function_sec = function_section(vmlib_function_types.map(x => types.lookup(x))
        .concat(functions.map(f => {
            const t = types.lookup(f.type)
            if (t) return t
            console.error(f)
            throw new Error(`unsupported function type ${f.type}`)
        })))

    const export_sec = export_section(functions.map(f =>
        export_entry(str_ascii(f.name), external_kind.function, functionIndex[f.address]),
    ).concat(
        export_entry(str_ascii("memory"), external_kind.memory, zero),
        export_entry(str_ascii("_push"), external_kind.function, vmlib_function_index(0)),
        export_entry(str_ascii("_pop"), external_kind.function, vmlib_function_index(1))
        ))

    const import_sec = import_section(vmlib_imports)

    const data_sec = data_section([data_segment(zero, init_expr([i32_zero]), data(image))])

    return c.module([
        type_section,
        import_sec,
        function_sec,
        memory_section([resizable_limits(memoryPages, memoryPages)]),
        global_section(stackStart, ramStart, endMem),
        export_sec,
        code_section(vmlib.concat(functions.map(f => function_body(f.opcodes, {
            callableFunctions: functionIndex,
            stackCalledFunctions,
            image,
            ramStart,
            endMem,
            stringTbl
        }, (f.stackCalled ? [c.local_entry(c.varint32(f.localsCount), c.i32)] : []))))),
        data_sec
    ])
} 