// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/


// Decode Glulx game images to AST

import { g, LoadOperandType, StoreOperandType, Opcode, 
    Constant, GlulxFunction, Return, function_type_no_args } from './ast'

export class ParseResult<T>{
    constructor(readonly v: T, readonly nextOffset: number) { }
}


const const_zero = g.const_(0)

function decodeFunctionSignature_in_in_out(image: Uint8Array, offset: number) {
    let a, b: LoadOperandType
    let x: StoreOperandType
    let length = 2
    const sig1 = image[offset]
    const sig2 = image[offset+1]
    switch (sig1) {
        case 0x00:  a = b = const_zero; break;
        case 0x11:  
            length += 2
            a = g.const_(image[offset+2])
            b = g.const_(image[offset+3])
            break
        default: throw new Error("unsupported parameter signature "+sig1)
    }
    switch (sig2) {
        case 0x00: x = g.discard; break;
        case 0x09: x = g.setLocalVariable(image[offset+length]); length++; break;
        default: throw new Error("unsupported return signature "+sig2)
    }
    return {
        a: a,
        b: b,
        x: x,
        nextOffset: offset + length
    }
}

function decodeFunctionSignature_in(image: Uint8Array, offset: number) {
    const sig = image[offset]
    let a : LoadOperandType
    let length = 1
    switch (sig){
        case 0x00: a = const_zero; break;
        case 0x01:
            length++
            a = g.const_(image[offset+1])
            break;
        default:  throw new Error("unsupported parameter signature "+sig)
    }
    return {
        a: a, nextOffset: offset + length
    }
}

export function decodeOpcode(image: Uint8Array, offset: number): ParseResult<Opcode> {
    const opcode = image[offset]
    switch (opcode) {
        case 0x10:
            let { a, b, x, nextOffset } = decodeFunctionSignature_in_in_out(image, offset+1)
            return new ParseResult(g.add(a, b, x), nextOffset)
        case 0x20:
            let sig = decodeFunctionSignature_in(image, offset+1)
            if (sig.a instanceof Constant){
                if (sig.a.v == 0 || sig.a.v == 1) return new ParseResult(g.return_(sig.a), sig.nextOffset)
            }
            throw new Error('jumps are not implemented')
        default: 
            throw new Error(`unknown opcode ${opcode} at ${offset}`)
    }
}

export function decodeFunction(image: Uint8Array, offset: number, name?: string): ParseResult<GlulxFunction> {
    const callType = image[offset]
    switch (callType) {
        case 0xC0: throw new Error("stack-called functions are not implemented")
        case 0xC1:
            const argType = image[offset+1]
            const argCount = image[offset+2]
            if (argCount > 0) throw new Error("function arguments are not implemented")
            offset = offset+3
            let opcodes : Opcode[] = []
            while(true){
                let opcode = decodeOpcode(image, offset)
                opcodes.push(opcode.v)
                offset = opcode.nextOffset
                if (opcode.v instanceof Return){
                    break
                }
            }
            return new ParseResult(
                new GlulxFunction(name || ("_"+offset.toString()), 
                function_type_no_args, false, opcodes), offset)
    }
}