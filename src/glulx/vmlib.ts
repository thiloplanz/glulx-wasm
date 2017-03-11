// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/

// Internal functions to support the runtime
// These are included in each compiled module

import { c, FunctionBody, GlobalSection, FuncType, I32ops, Op, Void } from '../ast'
import { uint32 } from '../basic-types'


export const function_type_i32 = c.func_type([c.i32], c.i32)
export const function_type_no_args = c.func_type([], c.i32)
export const function_type_i32_void = c.func_type([c.i32])


const immutable = c.global_type(c.i32, false)

const mutable = c.global_type(c.i32, true)

const zero = c.i32.const(0)

export function globals(stackStart: uint32) {
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


export const vmlib_function_types = [
    // push
    function_type_i32, // TODO: void does not work yet: https://github.com/rsms/wasm-util/issues/3
    // pop
    function_type_no_args
]


export const vmlib = [

    // push(value)
    c.function_body([], [
        // TODO: check for stack overflow
        c.i32.store(c.align32, SP, arg0),
        c.set_global(STACK_POINTER, c.i32.add(SP, fourBytes)),
        c.return_(arg0)
    ]),

    // pop
    c.function_body([], [
        // TODO: check for stack underflow
        c.set_global(STACK_POINTER, c.i32.sub(SP, fourBytes)),
        c.return_(c.i32.load(c.align32, SP))
    ])
]


export const vmlib_call = {
    push: function (value): Op<Void> { return c.drop(c.void, c.call(c.i32, c.varuint32(0), [value])) },
    pop: c.call(c.i32, c.varuint32(1), [])
}