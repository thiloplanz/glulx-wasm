// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/


// Decode Glulx game images to AST

import {
    g, LoadOperandType, StoreOperandType, Opcode,
    Constant, GlulxFunction, Return, read_uint16, read_uint32,
    ConditionalJump, TranscodingContext
} from './ast'

import {
    types
} from './vmlib'

import {
    c, AnyOp
} from '../ast'


export class ParseResult<T>{
    constructor(readonly v: T, readonly nextOffset: number) { }
}

// we try to avoid decoding conditional jumps directly
// instead, we try to detect patterns like loops or if/then/else
class IfThenElse implements Opcode {
    constructor(readonly cond: ConditionalJump, readonly thenBlock: Opcode[], readonly elseBlock: Opcode[]) { }
    transcode(context: TranscodingContext) {
        let cond = this.cond.transcodeCondition(context)
        return c.if(c.void,
            cond,
            (this.thenBlock.length == 0) ? [c.nop] : this.thenBlock.map(x => x.transcode(context)),
            this.elseBlock.map(x => x.transcode(context))
        )
    }
}

const uint16 = read_uint16
const uint32 = read_uint32

const const_zero = g.const_(0)

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

function decodeFunctionSignature_in_in_in(image: Uint8Array, offset: number) {
    const sig = image[offset]
    const sig2 = image[offset + 1]
    let a = decodeLoadOperand(0x0F & sig, image, offset + 2)
    let b = decodeLoadOperand(sig >>> 4, image, a.nextOffset)
    let c = decodeLoadOperand(0x0F & sig2, image, b.nextOffset)
    return {
        a: a.v, b: b.v, c: c.v, nextOffset: c.nextOffset
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
        case 0x25:  // jne
            sig = decodeFunctionSignature_in_in_in(image, offset + 1)
            return new ParseResult(g.jne(sig.a, sig.b, sig.c), sig.nextOffset)
        case 0x31:  // return
            sig = decodeFunctionSignature_in(image, offset + 1)
            return new ParseResult(g.return_(sig.a), sig.nextOffset)
        case 0x40:  // copy
            sig = decodeFunctionSignature_in_out(image, offset + 1)
            return new ParseResult(g.copy(sig.a, sig.out), sig.nextOffset)
        case 0x70: // streamchar
            sig = decodeFunctionSignature_in(image, offset + 1)
            return new ParseResult(g.streamchar(sig.a), sig.nextOffset)
        case 0x71: // streamnum
            sig = decodeFunctionSignature_in(image, offset + 1)
            return new ParseResult(g.streamnum(sig.a), sig.nextOffset)
        case 0x72: // streamstr
            sig = decodeFunctionSignature_in(image, offset + 1)
            return new ParseResult(g.streamstr(sig.a), sig.nextOffset)
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
                ftype = types.out
            }
            else {
                if (argType != 4) throw new Error("only 32bit arguments are implemented")
                if (argCount != 1)
                    if (image[offset] != 0) throw new Error("only a single argument group is implemented")
                offset += 2
                switch (argCount) {
                    case 0: ftype = types.out; break;
                    case 1: ftype = types.in_out; break;
                    case 2: ftype = types.in_in_out; break;
                    default: throw new Error("unsupported number of arguments: " + argCount)
                }

            }
            let opcodes: Opcode[] = []
            while (true) {
                let opcode = decodeOpcode(image, offset)
                if (opcode.v instanceof ConditionalJump) {
                    // try to detect common jump pattern
                    let jumpOpcode;
                    let vector = opcode.v.vector
                    if (vector instanceof Constant) {
                        let jump = vector.v
                        if (jump >= 0) {
                            if (jump < 3) {
                                // return or nop
                                jumpOpcode = opcode.v
                            } else {
                                // if/then/else ?
                                let elseOffset = opcode.nextOffset
                                let thenOffset = elseOffset
                                let elsePart = []
                                while (true) {
                                    let elseOp = decodeOpcode(image, thenOffset)
                                    elsePart.push(elseOp.v)
                                    thenOffset = elseOp.nextOffset
                                    if (elseOp.v instanceof Return) {
                                        // TODO: have a thenPart, don't just fall through
                                        jumpOpcode = new IfThenElse(opcode.v, [], elsePart)
                                        opcode = { v: jumpOpcode, nextOffset: thenOffset }
                                        break
                                    }
                                }

                            }
                        }

                    }
                    if (!jumpOpcode) console.warn(`got a conditional jump at ${offset}, but did not detect a common pattern`)
                }
                opcodes.push(opcode.v)
                offset = opcode.nextOffset
                if (opcode.v instanceof Return) {
                    break
                }
            }
            return new ParseResult(
                new GlulxFunction(offset, name || ("_" + offset.toString()),
                    ftype, false, opcodes), offset)
    }
}