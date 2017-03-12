// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/

// Internal functions to support the runtime
// These are included in each compiled module

import {
    c, FunctionBody, GlobalSection, TypeSection, FuncType, I32ops, Op, Void, VarUint32,
    ImportEntry, I32, AnyResult
} from '../ast'
import { uint32 } from '../basic-types'

export const types = {
    in_in_out: c.func_type([c.i32, c.i32], c.i32),
    in_out: c.func_type([c.i32], c.i32),
    out: c.func_type([], c.i32),
    in: c.func_type([c.i32]),  // TODO: void does not work yet: https://github.com/rsms/wasm-util/issues/3
    lookup: (type: FuncType) => all_types_indexes[all_types.findIndex(f => f == type)]
}

const all_types = [types.in_out, types.out, types.in, types.in_in_out]
const all_types_indexes = all_types.map((x, i) => c.varuint32(i))

export const type_section = c.type_section(all_types)

const immutable = c.global_type(c.i32, false)
const mutable = c.global_type(c.i32, true)
const zero = c.i32.const(0)

export function global_section(stackStart: uint32) {
    const stack = c.i32.const(stackStart)
    return c.global_section([
        // 0: stack start address
        c.global_variable(immutable, c.init_expr([stack])),
        // 1: stack pointer
        c.global_variable(mutable, c.init_expr([stack])),
        // TODO: stack size, endMem
    ])
}

const STACK_START = 0
const STACK_POINTER = 1
const arg0 = c.get_local(c.i32, 0)

const SP = c.get_global(c.i32, STACK_POINTER)

const fourBytes = c.i32.const(4)

const lib = [
    // push value
    [types.in_out, c.function_body([], [
        // TODO: check for stack overflow
        c.i32.store(c.align32, SP, arg0),
        c.set_global(STACK_POINTER, c.i32.add(SP, fourBytes)),
        c.return_(arg0) // TODO: void does not work yet: https://github.com/rsms/wasm-util/issues/3
    ])],
    // value := pop
    [types.out, c.function_body([], [
        // TODO: check for stack underflow
        c.set_global(STACK_POINTER, c.i32.sub(SP, fourBytes)),
        c.return_(c.i32.load(c.align32, SP))
    ])]
]


export const vmlib_function_types: FuncType[] = lib.map(f => f[0] as FuncType)

export const vmlib: FunctionBody[] = lib.map(f => f[1] as FunctionBody)

const imports = c.str_ascii("vmlib_support")

// callbacks the embedding code needs to be provide so that the module
// can interact with the outside world
export const vmlib_imports = [
    c.function_import_entry(imports, c.str_ascii("glk"), types.lookup(types.in_in_out))
]


export const vmlib_function_offset = vmlib_imports.length

export const vmlib_call = {
    // imports come first
    glk: function (selector: Op<I32>, argc: Op<I32>): Op<I32> {
        return c.call(c.i32, c.varuint32(0), [selector, argc])
    },

    // then our vmlib functions
    push: function (value): Op<Void> { return c.drop(c.void, c.call(c.i32, c.varuint32(vmlib_function_offset), [value])) },
    pop: c.call(c.i32, c.varuint32(vmlib_function_offset + 1), []),
}
