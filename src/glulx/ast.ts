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

export const function_type_i32     = c.func_type([c.i32], c.i32)

export const function_type_no_args = c.func_type([], c.i32) 


export class Return implements Transcodable {
    constructor(private readonly v: LoadOperandType) { }
    transcode() { return c.return_(this.v.transcode()) }
}

class Add implements Transcodable {
    constructor(private readonly a: LoadOperandType, private readonly b: LoadOperandType, private readonly x: StoreOperandType) { }
    transcode() { return this.x.transcode(c.i32.add(this.a.transcode(), this.b.transcode())) }
}

export class Constant implements LoadOperandType {
    constructor(readonly v: uint32) { }
    transcode() { return c.i32.const(this.v) }
}

class Local32 implements LoadOperandType {
    constructor(private readonly v: uint32) { }
    transcode() { return c.get_local(c.i32, this.v) }
}

class StoreLocal32 implements StoreOperandType {
    constructor(private readonly v: uint32) { }
    transcode(input: Op<I32>) { return c.set_local(this.v, input) }
}

class Discard implements StoreOperandType{
    transcode(input: Op<I32>) { return c.drop(c.void_, input) }
}

const discard : StoreOperandType = new Discard


export const g = {
    const_(v: uint32): Constant { return new Constant(v) },

    discard: discard,

    localVariable(index: uint32): LoadOperandType {
        if (index % 4 != 0) throw new Error(`invalid local variable offset ${index}`)
        return new Local32(index / 4)
    },

    setLocalVariable(index: uint32): StoreOperandType {
        if (index % 4 != 0) throw new Error(`invalid local variable offset ${index}`)
        return new StoreLocal32(index / 4)
    },

    add(a: LoadOperandType, b: LoadOperandType, x: StoreOperandType): Opcode { return new Add(a, b, x) },

    return_(v: LoadOperandType): Opcode { return new Return(v) },

    function_i32_i32(name: string, opcodes: Opcode[]): GlulxFunction {
        return new GlulxFunction(name, function_type_i32, false, opcodes)
    }
}
