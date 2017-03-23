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
const mutable64 = c.global_type(c.i64, true)
const zero = c.i32.const(0)
const one = c.i32.const(1)

export function global_section(stackStart: uint32, ramStart: uint32, endMem: uint32) {
    const stack = c.init_expr([c.i32.const(stackStart)])
    return c.global_section([
        // 0: stack start address
        c.global_variable(immutable, stack),
        // 1: stack pointer
        c.global_variable(mutable, stack),
        // 2: RAMSTART
        c.global_variable(immutable, c.init_expr([c.i32.const(ramStart)])),
        // 3: ENDMEM (64 bits for overflow-safe range checking)
        c.global_variable(mutable64, c.init_expr([c.i64.const(endMem)]))
        // TODO: stack size
    ])
}

const STACK_START = 0
const STACK_POINTER = 1
const RAMSTART = 2
const ENDMEM = 3

const arg0 = c.get_local(c.i32, 0)
const arg1 = c.get_local(c.i32, 1)

const SP = c.get_global(c.i32, STACK_POINTER)

const fourBytes = c.i32.const(4)
const eightBits = c.i32.const(8)
const sixteenBits = c.i32.const(16)
const twentyFourBits = c.i32.const(24)

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
    ])],
    // load from memory
    [types.in_out, c.function_body([], function () {
        // need to convert between big-endian (Glulx) and little-endian (wasm)
        const a3 = c.i32.load8_u(c.align8, arg0)
        const a2 = c.i32.load8_u(c.align8, c.i32.add(arg0, one))
        const a1 = c.i32.load8_u(c.align8, c.i32.add(arg0, c.i32.const(2)))
        const a0 = c.i32.load8_u(c.align8, c.i32.add(arg0, c.i32.const(3)))

        return [
            // after ENDMEM?
            c.if(c.void, c.i64.ge_u(c.i64.add(c.i64.const(3), c.i64.extend_u_i32(arg0)), c.get_global(c.i64, ENDMEM)),
                [c.unreachable]),
            c.i32.add(
                c.i32.add(c.i32.shl(a1, eightBits), a0),
                c.i32.shl(c.i32.add(c.i32.shl(a3, eightBits), a2), sixteenBits))
        ]
    }())],
    // write to memory
    [types.in_in_out, c.function_body([], function () {
        // need to convert between big-endian (Glulx) and little-endian (wasm)
        const a3 = c.i32.store8(c.align8, arg0, c.i32.shr_u(arg1, twentyFourBits))
        const a2 = c.i32.store8(c.align8, c.i32.add(arg0, one), c.i32.shr_u(arg1, sixteenBits))
        const a1 = c.i32.store8(c.align8, c.i32.add(arg0, c.i32.const(2)), c.i32.shr_u(arg1, eightBits))
        const a0 = c.i32.store8(c.align8, c.i32.add(arg0, c.i32.const(3)), arg1)

        return [
            // after ENDMEM?
            c.if(c.void, c.i64.ge_u(c.i64.add(c.i64.const(3), c.i64.extend_u_i32(arg0)), c.get_global(c.i64, ENDMEM)),
                [c.unreachable]),
            // before RAMSTART?
            c.if(c.void, c.i32.lt_u(arg0, c.get_global(c.i32, RAMSTART)),
                [c.unreachable]),
            a3, a2, a1, a0,
            arg1    // dummy return, because "void" does not work yet
        ]
    }())],
]


export const vmlib_function_types: FuncType[] = lib.map(f => f[0] as FuncType)

export const vmlib: FunctionBody[] = lib.map(f => f[1] as FunctionBody)

const imports = c.str_ascii("vmlib_support")

// callbacks the embedding code needs to be provide so that the module
// can interact with the outside world
export const vmlib_imports = [
    c.function_import_entry(imports, c.str_ascii("glk"), types.lookup(types.in_in_out))
]


export function vmlib_function_index(index: number) {
    return c.varuint32(vmlib_imports.length + index)
}

function vmlib_function_call(index: number, params: Op<AnyResult>[]) {
    return c.call(c.i32, vmlib_function_index(index), params)
}


export const vmlib_call = {
    // imports come first
    glk: function (selector: Op<I32>, argc: Op<I32>): Op<I32> {
        return c.call(c.i32, c.varuint32(0), [selector, argc])
    },

    // then our vmlib functions
    push: function (value): Op<Void> { return c.drop(c.void, vmlib_function_call(0, [value])) },
    pop: vmlib_function_call(1, []),
    read_uint32: function (addr: Op<I32>): Op<I32> { return vmlib_function_call(2, [addr]) },
    store_uint32: function (addr: Op<I32>, v: Op<I32>): Op<Void> { return c.drop(c.void, vmlib_function_call(3, [addr, v])) }
}