// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/


// Decode Glulx game images to AST

import {
    g, LoadOperandType, StoreOperandType, Opcode,
    Constant, GlulxFunction, Return, function_type_no_args,
    function_type_i32
} from './ast'

export class ParseResult<T>{
    constructor(readonly v: T, readonly nextOffset: number) { }
}


const const_zero = g.const_(0)

function uint16(image: Uint8Array, offset: number) {
    return image[offset] * 256 + image[offset + 1]
}

function uint32(image: Uint8Array, offset: number) {
    return image[offset] * 0x1000000 + image[offset + 1] * 0x10000 + image[offset + 2] * 0x100 + image[offset + 3]
}

function decodeLoadOperand(code: number, image: Uint8Array, offset: number) {
    // TODO: opcode rule about address decoding format
    switch (code) {
        case 0x0: return new ParseResult(const_zero, offset)
        case 0x1: return new ParseResult(g.const_(image[offset]), offset + 1)
        case 0x2: return new ParseResult(g.const_(uint16(image, offset)), offset + 2)
        case 0x3: return new ParseResult(g.const_(uint32(image, offset)), offset + 4)
        case 0x5: return new ParseResult(g.memory(image[offset]), offset + 1)
        case 0x6: return new ParseResult(g.memory(uint16(image, offset)), offset + 2)
        case 0x7: return new ParseResult(g.memory(uint32(image, offset)), offset + 4)
        case 0x8: return new ParseResult(g.pop, offset)
        case 0x9: return new ParseResult(g.localVariable(image[offset]), offset + 1)
        case 0xA: return new ParseResult(g.localVariable(uint16(image, offset)), offset + 2)
        case 0xB: return new ParseResult(g.localVariable(uint32(image, offset)), offset + 4)
        case 0xD: return new ParseResult(g.ram(image[offset]), offset + 1)
        case 0xE: return new ParseResult(g.ram(uint16(image, offset)), offset + 2)
        case 0xF: return new ParseResult(g.ram(uint32(image, offset)), offset + 4)
        default: throw new Error("unsupported load operand type " + code)
    }
}

function decodeStoreOperand(code: number, image: Uint8Array, offset: number) {
    switch (code) {
        case 0x0: return new ParseResult(g.discard, offset);
        case 0x5: return new ParseResult(g.storeToMemory(image[offset]), offset + 1)
        case 0x6: return new ParseResult(g.storeToMemory(uint16(image, offset)), offset + 2)
        case 0x7: return new ParseResult(g.storeToMemory(uint32(image, offset)), offset + 4)
        case 0x8: return new ParseResult(g.push, offset)
        case 0x9: return new ParseResult(g.setLocalVariable(image[offset]), offset + 1)
        case 0xA: return new ParseResult(g.setLocalVariable(uint16(image, offset)), offset + 2)
        case 0xB: return new ParseResult(g.setLocalVariable(uint32(image, offset)), offset + 4)
        case 0xD: return new ParseResult(g.storeToRAM(image[offset]), offset + 1)
        case 0xE: return new ParseResult(g.storeToRAM(uint16(image, offset)), offset + 2)
        case 0xF: return new ParseResult(g.storeToRAM(uint32(image, offset)), offset + 4)
        default: throw new Error("unsupported store operand type " + code)
    }
}

function decodeFunctionSignature_in_in_out(image: Uint8Array, offset: number) {
    const sig1 = image[offset]
    const sig2 = image[offset + 1]
    let a = decodeLoadOperand(0x0F & sig1, image, offset + 2)
    let b = decodeLoadOperand(sig1 >>> 4, image, a.nextOffset)
    let x = decodeStoreOperand(0x0F & sig2, image, b.nextOffset)
    return {
        a: a.v,
        b: b.v,
        x: x.v,
        nextOffset: x.nextOffset
    }
}

function decodeFunctionSignature_in(image: Uint8Array, offset: number) {
    const sig = image[offset]
    let a = decodeLoadOperand(0x0F & sig, image, offset + 1)
    return {
        a: a.v, nextOffset: a.nextOffset
    }
}

function decodeFunctionSignature_in_out(image: Uint8Array, offset: number) {
    const sig = image[offset]
    let a = decodeLoadOperand(0x0F & sig, image, offset + 1)
    let out = decodeStoreOperand(sig >>> 4, image, a.nextOffset)
    return {
        a: a.v, out: out.v, nextOffset: out.nextOffset
    }
}

function decodeFunctionSignature_in_in(image: Uint8Array, offset: number) {
    const sig = image[offset]
    let a = decodeLoadOperand(0x0F & sig, image, offset + 1)
    let b = decodeLoadOperand(sig >>> 4, image, a.nextOffset)
    return {
        a: a.v, b: b.v, nextOffset: b.nextOffset
    }
}

export function decodeOpcode(image: Uint8Array, offset: number): ParseResult<Opcode> {
    const opcode = image[offset]
    let sig
    switch (opcode) {
        case 0x10:  // add
            let { a, b, x, nextOffset } = decodeFunctionSignature_in_in_out(image, offset + 1)
            return new ParseResult(g.add(a, b, x), nextOffset)
        case 0x20:  // jump
            sig = decodeFunctionSignature_in(image, offset + 1)
            return new ParseResult(g.jump(sig.a), sig.nextOffset)
        case 0x22:  // jz
            sig = decodeFunctionSignature_in_in(image, offset + 1)
            return new ParseResult(g.jz(sig.a, sig.b), sig.nextOffset)
        case 0x31:  // return
            sig = decodeFunctionSignature_in(image, offset + 1)
            return new ParseResult(g.return_(sig.a), sig.nextOffset)
        case 0x40:  // copy
            sig = decodeFunctionSignature_in_out(image, offset + 1)
            return new ParseResult(g.copy(sig.a, sig.out), sig.nextOffset)
        default:
            throw new Error(`unknown opcode ${opcode} at ${offset}`)
    }
}

export function decodeFunction(image: Uint8Array, offset: number, name?: string): ParseResult<GlulxFunction> {
    const callType = image[offset]
    switch (callType) {
        case 0xC0: throw new Error("stack-called functions are not implemented")
        case 0xC1:
            const argType = image[offset + 1]
            const argCount = image[offset + 2]
            offset = offset + 3
            let ftype
            if (argType == 0 && argCount == 0) {
                ftype = function_type_no_args
            }
            else {
                if (argType != 4) throw new Error("only 32bit arguments are implemented")
                if (argCount != 1) throw new Error("only a single function argument is implemented")
                if (image[offset] != 0) throw new Error("only a single argument group is implemented")
                offset += 2
                ftype = function_type_i32
            }
            let opcodes: Opcode[] = []
            while (true) {
                let opcode = decodeOpcode(image, offset)
                opcodes.push(opcode.v)
                offset = opcode.nextOffset
                if (opcode.v instanceof Return) {
                    break
                }
            }
            return new ParseResult(
                new GlulxFunction(name || ("_" + offset.toString()),
                    ftype, false, opcodes), offset)
    }
}