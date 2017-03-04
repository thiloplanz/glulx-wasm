// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/


// AST for Glulx functions

import {c, N, I32, Op, FunctionBody} from '../ast'
import {uint32} from '../basic-types'

export interface Transcodable{
    transcode() : N
}

export interface Opcode extends Transcodable{

}

export interface LoadOperandType extends Transcodable {
    transcode(): Op<I32>
}

class Return implements Transcodable {
    constructor(private readonly v: LoadOperandType){}
    transcode() { return c.return_(this.v.transcode()) }
}

class Constant implements LoadOperandType {
    constructor(private readonly v: uint32){}
    transcode()  { return c.i32.const(this.v)}
}

class Local32 implements LoadOperandType {
    constructor(private readonly v: uint32){}
    transcode()  { return c.get_local(c.i32, this.v)}
}

export const g = {
    
    function_body(opcodes: Opcode[]): FunctionBody { 
        return c.function_body([ /* additional local variables here */ ], opcodes.map(o => o.transcode())) 
    },

    const_(v: uint32) : LoadOperandType { return new Constant(v)} ,

    localVariable(index: uint32) : LoadOperandType { 
        if (index % 4 != 0) throw new Error(`invalid local variable offset ${index}`)
        return new Local32(index/4)
    },

    return_(v: LoadOperandType) : Transcodable { return new Return(v)}
}
