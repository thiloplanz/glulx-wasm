// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/


// AST for Glulx functions

import { c, N, I32, Void, Op, FunctionBody, FuncType } from '../ast'
import { uint32 } from '../basic-types'

export interface Transcodable {
    transcode(): N
}

export interface Opcode extends Transcodable {

}

export interface LoadOperandType extends Transcodable {
    transcode(): Op<I32>
}

export interface StoreOperandType {
    transcode(input: Op<I32>): Op<Void>
}

export class GlulxFunction {
    constructor(
        readonly name: string,
        readonly type: FuncType,
        readonly stackCalled: Boolean,
        readonly opcodes: Opcode[]) { }
}

export const function_type_i32 = c.func_type([c.i32], c.i32)

export const function_type_no_args = c.func_type([], c.i32)


export class Return implements Opcode {
    constructor(private readonly v: LoadOperandType) { }
    transcode() { return c.return_(this.v.transcode()) }
}

const zero = c.i32.const(0)
const one = c.i32.const(1)
const two = c.i32.const(2)
const return_zero = c.return_(zero)
const return_one = c.return_(one)

// the special cases (0,1 = return, 2 = nop) for jump instructions
const jump_vectors = [c.varuint32(0), c.varuint32(1), c.varuint32(3)]
const real_jump = c.varuint32(2)

class Jump implements Opcode {
    constructor(private readonly v: LoadOperandType) { }
    transcode() {
        const v = this.v
        // optimization for constant jump vectors
        if (v instanceof Constant) {
            if (v.v == 0) return return_zero
            if (v.v == 1) return return_one
            if (v.v == 2) return c.nop
            return c.unreachable /* actual jumps are not implemented*/
        }
        const tv = v.transcode()
        return c.void_block([c.void_block([c.void_block([c.void_block([
            c.br_table(jump_vectors, real_jump, tv),
        ]),
            return_zero
        ]),
            return_one
        ]),
        c.unreachable /* actual jumps are not implemented*/
        ])

    }
}

class JumpIfZero implements Opcode {
    constructor(private readonly cond: LoadOperandType, private readonly v: LoadOperandType) { }
    transcode() {
        const { cond, v } = this
        const jump = new Jump(v).transcode()
        // (premature) optimization for constant condition
        if (cond instanceof Constant) {
            if (cond.v == 0) return jump
            return c.nop
        }
        return c.if_(c.void, c.i32.eqz(cond.transcode()), [jump])
    }
}

class Add implements Opcode {
    constructor(private readonly a: LoadOperandType, private readonly b: LoadOperandType, private readonly x: StoreOperandType) { }
    transcode() { return this.x.transcode(c.i32.add(this.a.transcode(), this.b.transcode())) }
}

class Copy implements Opcode {
    constructor(private readonly a: LoadOperandType, private readonly x: StoreOperandType) { }
    transcode() { return this.x.transcode(this.a.transcode()) }
}

export class Constant implements LoadOperandType {
    constructor(readonly v: uint32) { }
    transcode() { return c.i32.const(this.v) }
}

class MemoryAccess implements LoadOperandType {
    constructor(readonly address: uint32) { }
    transcode(): Op<I32> {
        // TODO range checking
        return c.i32.load(c.align32, c.i32.const(this.address))
    }
}

class MemoryStore implements StoreOperandType {
    constructor(private readonly v: uint32) { }
    transcode(input: Op<I32>): Op<Void> { throw new Error("MemoryAccess not implemented") }
}

class RAMAccess implements LoadOperandType {
    constructor(readonly address: uint32) { }
    transcode(): Op<I32> { throw new Error("MemoryAccess not implemented") }
}

class RAMStore implements StoreOperandType {
    constructor(private readonly v: uint32) { }
    transcode(input: Op<I32>): Op<Void> { throw new Error("MemoryAccess not implemented") }
}

class Pop implements LoadOperandType {
    transcode(): Op<I32> { throw new Error("Stack not implemented") }
}

class Push implements StoreOperandType {
    transcode(): Op<Void> { throw new Error("Stack not implemented") }
}

class Local32 implements LoadOperandType {
    constructor(private readonly v: uint32) { }
    transcode() { return c.get_local(c.i32, this.v) }
}

class StoreLocal32 implements StoreOperandType {
    constructor(private readonly v: uint32) { }
    transcode(input: Op<I32>) { return c.set_local(this.v, input) }
}

class Discard implements StoreOperandType {
    transcode(input: Op<I32>) { return c.drop(c.void_, input) }
}


const discard: StoreOperandType = new Discard

const pop: LoadOperandType = new Pop

const push: StoreOperandType = new Push

export const g = {
    const_(v: uint32): Constant { return new Constant(v) },

    memory(address: uint32): LoadOperandType { return new MemoryAccess(address) },

    ram(address: uint32): LoadOperandType { return new RAMAccess(address) },

    pop: pop,

    push: push,

    discard: discard,

    localVariable(index: uint32): LoadOperandType {
        if (index % 4 != 0) throw new Error(`invalid local variable offset ${index}`)
        return new Local32(index / 4)
    },

    setLocalVariable(index: uint32): StoreOperandType {
        if (index % 4 != 0) throw new Error(`invalid local variable offset ${index}`)
        return new StoreLocal32(index / 4)
    },

    storeToMemory(addr: uint32): StoreOperandType {
        return new MemoryStore(addr)
    },

    storeToRAM(addr: uint32): StoreOperandType {
        return new RAMStore(addr)
    },

    add(a: LoadOperandType, b: LoadOperandType, x: StoreOperandType): Opcode { return new Add(a, b, x) },

    copy(a: LoadOperandType, x: StoreOperandType): Opcode { return new Copy(a, x) },

    return_(v: LoadOperandType): Opcode { return new Return(v) },

    jump(v: LoadOperandType): Opcode { return new Jump(v) },

    jz(condition: LoadOperandType, vector: LoadOperandType): Opcode { return new JumpIfZero(condition, vector) },

    function_i32_i32(name: string, opcodes: Opcode[]): GlulxFunction {
        return new GlulxFunction(name, function_type_i32, false, opcodes)
    }
}
