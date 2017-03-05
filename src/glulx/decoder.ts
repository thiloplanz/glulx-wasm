// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/


// Decode Glulx game images to AST

import { g, LoadOperandType, StoreOperandType, Opcode } from './ast'

export class ParseResult<T>{
    constructor(readonly v: T, nextOffset: number) { }
}


function decodeFunctionSignature_in_in_out(image: Uint8Array, offset: number) {
    let a, b: LoadOperandType
    let x: StoreOperandType
    let length = 2
    const sig1 = image[offset]
    const sig2 = image[offset+1]
    switch (sig1) {
        case 0x00:  a = b = g.const_(0); break;
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

export function decodeOpcode(image: Uint8Array, offset: number): ParseResult<Opcode> {
    const opcode = image[offset]
    switch (opcode) {
        case 0x10:
            let { a, b, x, nextOffset } = decodeFunctionSignature_in_in_out(image, offset+1)
            return new ParseResult(g.add(a, b, x), nextOffset)
    }
}