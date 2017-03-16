// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/


// AST for Glulx functions

import { c, sect_id, N, I32, Void, Op, FunctionBody, FuncType, VarUint32, Module } from '../ast'
import { uint32 } from '../basic-types'
import { vmlib_call, types } from './vmlib'
import { GlkSelector } from './host'

export interface TranscodingContext {
    callableFunctions: VarUint32[],
    image: Uint8Array,
    ramStart: uint32,
    endMem: uint32
}

export interface Transcodable {
    transcode(context: TranscodingContext): N
}

export interface Opcode extends Transcodable {

}

export interface LoadOperandType extends Transcodable {
    transcode(context: TranscodingContext): Op<I32>
}

export interface StoreOperandType {
    transcode(input: Op<I32>): Op<Void>
}

export class GlulxFunction {
    constructor(
        readonly address: uint32,
        readonly name: string,
        readonly type: FuncType,
        readonly stackCalled: Boolean,
        readonly opcodes: Opcode[]) { }
}



export class Return implements Opcode {
    constructor(private readonly v: LoadOperandType) { }
    transcode(context) { return c.return_(this.v.transcode(context)) }
}

class Callf implements Opcode {
    constructor(private readonly address: LoadOperandType, private readonly args: LoadOperandType[], private readonly result: StoreOperandType) { }
    transcode(context: TranscodingContext) {
        const { address, args, result } = this
        if (address instanceof Constant) {
            const index = context.callableFunctions[address.v]
            if (!index) {
                console.error(`unknown function being called: ${address}`)
                return c.unreachable
            }
            return result.transcode(c.call(c.i32, index, args.map(x => x.transcode(context))))
        }
        return c.unreachable /* dynamic calls are not implemented */
    }
}

class GlkCall implements Opcode {
    constructor(private readonly selector: LoadOperandType, private readonly argc: LoadOperandType, private readonly result: StoreOperandType) { }
    transcode(context: TranscodingContext) {
        const { selector, argc, result } = this
        // we pass this out to Javascript to dispatch (and get the parameters from the stack)
        return result.transcode(vmlib_call.glk(selector.transcode(context), argc.transcode(context)))
    }
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
    transcode(context) {
        const v = this.v
        // optimization for constant jump vectors
        if (v instanceof Constant) {
            if (v.v == 0) return return_zero
            if (v.v == 1) return return_one
            if (v.v == 2) return c.nop
            return c.unreachable /* actual jumps are not implemented*/
        }
        const tv = v.transcode(context)
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
    transcode(context) {
        const { cond, v } = this
        const jump = new Jump(v).transcode(context)
        // (premature) optimization for constant condition
        if (cond instanceof Constant) {
            if (cond.v == 0) return jump
            return c.nop
        }
        return c.if_(c.void, c.i32.eqz(cond.transcode(context)), [jump])
    }
}

class Add implements Opcode {
    constructor(private readonly a: LoadOperandType, private readonly b: LoadOperandType, private readonly x: StoreOperandType) { }
    transcode(context) { return this.x.transcode(c.i32.add(this.a.transcode(context), this.b.transcode(context))) }
}

class Copy implements Opcode {
    constructor(private readonly a: LoadOperandType, private readonly x: StoreOperandType) { }
    transcode(context) { return this.x.transcode(this.a.transcode(context)) }
}

export class Constant implements LoadOperandType {
    constructor(readonly v: uint32) { }
    transcode() { return c.i32.const(this.v) }
}


export function read_uint16(image: Uint8Array, offset: number) {
    return image[offset] * 256 + image[offset + 1]
}

export function read_uint32(image: Uint8Array, offset: number) {
    return image[offset] * 0x1000000 + image[offset + 1] * 0x10000 + image[offset + 2] * 0x100 + image[offset + 3]
}

class MemoryAccess implements LoadOperandType {
    constructor(readonly address: uint32) { }
    transcode(context: TranscodingContext): Op<I32> {
        // inline access to ROM 
        const { address } = this
        if (address < context.ramStart)
            return c.i32.const(read_uint32(context.image, address))

        return vmlib_call.read_uint32(c.i32.const(address))
    }
}

class MemoryStore implements StoreOperandType {
    constructor(private readonly addr: uint32) { }
    transcode(input: Op<I32>): Op<Void> {
        return vmlib_call.store_uint32(c.i32.const(this.addr), input)
    }
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
    transcode(): Op<I32> { return vmlib_call.pop }
}

class Push implements StoreOperandType {
    transcode(input: Op<I32>): Op<Void> { return vmlib_call.push(input) }
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

    callf(address: LoadOperandType, args: LoadOperandType[], result: StoreOperandType): Opcode {
        if (args.length > 3) throw new Error(`callf does not take more than three arguments, you gave me ${args.length}`)
        return new Callf(address, args, result)
    },

    glk: {
        put_char: function (latin1: LoadOperandType) {
            return [
                g.copy(latin1, g.push),
                new GlkCall(g.const_(GlkSelector.put_char), g.const_(1), g.discard)
            ]
        }
    },

    jump(v: LoadOperandType): Opcode { return new Jump(v) },

    jz(condition: LoadOperandType, vector: LoadOperandType): Opcode { return new JumpIfZero(condition, vector) },

    function_i32_i32(address: uint32, name: string, opcodes: Opcode[]): GlulxFunction {
        return new GlulxFunction(address, name, types.in_out, false, opcodes)
    }
}
