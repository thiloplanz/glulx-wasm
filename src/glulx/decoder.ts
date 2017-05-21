// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/


// Decode Glulx game images to AST

import {
    g, StoreOperandType, Opcode,
    Constant, GlulxFunction, Return, read_uint16, read_uint32,
    Jump, ConditionalJump, TranscodingContext, GlkCall
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
class WhileLoop implements Opcode {
    constructor(readonly cond: ConditionalJump, readonly body: Opcode[]) { }
    transcode(context: TranscodingContext) {
        let cond = this.cond.transcodeCondition(context)
        return c.void_loop([c.if(c.void,
            cond,
            [c.br(0)],
            this.body.map(x => x.transcode(context))
        )]
        )
    }
}

const uint16 = read_uint16
const uint32 = read_uint32

// coerce uint32 number into  (signed!) int32 range
function int32(image, offset): number {
    let x = uint32(image, offset)
    if (x >= 0x80000000) {
        x = - (0xFFFFFFFF - x + 1);
    }
    return x;
}
function int16(image, offset): number {
    let x = uint16(image, offset)
    if (x >= 0x8000) {
        x = - (0xFFFF - x + 1);
    }
    return x;
}
function int8(image, offset): number {
    let x = image[offset]
    if (x >= 0x80) {
        x = - (0xFF - x + 1);
    }
    return x;
}


const const_zero = g.const_(0)

function decodeLoadOperand(code: number, image: Uint8Array, offset: number) {
    // TODO: opcode rule about address decoding format
    switch (code) {
        case 0x0: return new ParseResult(const_zero, offset)
        case 0x1:  // -128 to 127 
            return new ParseResult(g.const_(int8(image, offset)), offset + 1)
        case 0x2: // -32768 to 32767
            return new ParseResult(g.const_(int16(image, offset)), offset + 2)
        case 0x3: return new ParseResult(g.const_(int32(image, offset)), offset + 4)
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

function decodeFunctionSignature_in_in_in_out(image: Uint8Array, offset: number) {
    const sig1 = image[offset]
    const sig2 = image[offset + 1]
    let a = decodeLoadOperand(0x0F & sig1, image, offset + 2)
    let b = decodeLoadOperand(sig1 >>> 4, image, a.nextOffset)
    let c = decodeLoadOperand(0x0F & sig2, image, b.nextOffset)
    let x = decodeStoreOperand(sig2 >>> 4, image, c.nextOffset)
    return {
        a: a.v,
        b: b.v,
        c: c.v,
        x: x.v,
        nextOffset: x.nextOffset
    }
}

function decodeFunctionSignature_in_in_in_in_out(image: Uint8Array, offset: number) {
    const sig1 = image[offset]
    const sig2 = image[offset + 1]
    const sig3 = image[offset + 2]
    let a = decodeLoadOperand(0x0F & sig1, image, offset + 3)
    let b = decodeLoadOperand(sig1 >>> 4, image, a.nextOffset)
    let c = decodeLoadOperand(0x0F & sig2, image, b.nextOffset)
    let d = decodeLoadOperand(sig2 >>> 4, image, c.nextOffset)
    let x = decodeStoreOperand(0x0F & sig3, image, d.nextOffset)
    return {
        a: a.v,
        b: b.v,
        c: c.v,
        d: d.v,
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

function decodeFunctionSignature_out(image: Uint8Array, offset: number) {
    const sig = image[offset]
    let a = decodeStoreOperand(0x0F & sig, image, offset + 1)
    return {
        out: a.v, nextOffset: a.nextOffset
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
    let opcode = image[offset]
    if (opcode < 0x80) {
        // one-byte opcode
        offset++;
    } else if (opcode < 0xC0) {
        // two-byte opcode
        opcode = read_uint16(image, offset) - 0x8000
        offset += 2
    } else {
        // four-byte opcode
        opcode = read_uint32(image, offset) - 0xC0000000
        offset += 4
    }
    let sig

    switch (opcode) {
        case 0x10:  // add
            sig = decodeFunctionSignature_in_in_out(image, offset)
            return new ParseResult(g.add(sig.a, sig.b, sig.x), sig.nextOffset)
        case 0x11:  // sub
            sig = decodeFunctionSignature_in_in_out(image, offset)
            return new ParseResult(g.sub(sig.a, sig.b, sig.x), sig.nextOffset)
        case 0x12: // mul
            sig = decodeFunctionSignature_in_in_out(image, offset)
            return new ParseResult(g.mul(sig.a, sig.b, sig.x), sig.nextOffset)
        case 0x20:  // jump
            sig = decodeFunctionSignature_in(image, offset)
            return new ParseResult(g.jump(sig.a), sig.nextOffset)
        case 0x22:  // jz
            sig = decodeFunctionSignature_in_in(image, offset)
            return new ParseResult(g.jz(sig.a, sig.b), sig.nextOffset)
        case 0x24:  // jeq
            sig = decodeFunctionSignature_in_in_in(image, offset)
            return new ParseResult(g.jeq(sig.a, sig.b, sig.c), sig.nextOffset)
        case 0x25:  // jne
            sig = decodeFunctionSignature_in_in_in(image, offset)
            return new ParseResult(g.jne(sig.a, sig.b, sig.c), sig.nextOffset)
        case 0x26:  // jlt
            sig = decodeFunctionSignature_in_in_in(image, offset)
            return new ParseResult(g.jlt(sig.a, sig.b, sig.c), sig.nextOffset)
        case 0x27: // jge
            sig = decodeFunctionSignature_in_in_in(image, offset)
            return new ParseResult(g.jge(sig.a, sig.b, sig.c), sig.nextOffset)
        case 0x28: // jgt
            sig = decodeFunctionSignature_in_in_in(image, offset)
            return new ParseResult(g.jgt(sig.a, sig.b, sig.c), sig.nextOffset)
        case 0x2b: // jgeu
            sig = decodeFunctionSignature_in_in_in(image, offset)
            return new ParseResult(g.jgeu(sig.a, sig.b, sig.c), sig.nextOffset)
        case 0x31:  // return
            sig = decodeFunctionSignature_in(image, offset)
            return new ParseResult(g.return_(sig.a), sig.nextOffset)
        case 0x40:  // copy
            sig = decodeFunctionSignature_in_out(image, offset)
            return new ParseResult(g.copy(sig.a, sig.out), sig.nextOffset)
        case 0x48: // aload
            sig = decodeFunctionSignature_in_in_out(image, offset)
            return new ParseResult(g.aload(sig.a, sig.b, sig.x), sig.nextOffset)
        case 0x4a: // aloadb
            sig = decodeFunctionSignature_in_in_out(image, offset)
            return new ParseResult(g.aloadb(sig.a, sig.b, sig.x), sig.nextOffset)
        case 0x70: // streamchar
            sig = decodeFunctionSignature_in(image, offset)
            return new ParseResult(g.streamchar(sig.a), sig.nextOffset)
        case 0x71: // streamnum
            sig = decodeFunctionSignature_in(image, offset)
            return new ParseResult(g.streamnum(sig.a), sig.nextOffset)
        case 0x72: // streamstr
            sig = decodeFunctionSignature_in(image, offset)
            return new ParseResult(g.streamstr(sig.a), sig.nextOffset)
        case 0x102: // getmemsize
            sig = decodeFunctionSignature_out(image, offset)
            return new ParseResult(g.getmemsize(sig.out), sig.nextOffset)
        case 0x130: // glk
            sig = decodeFunctionSignature_in_in_out(image, offset)
            return new ParseResult(new GlkCall(sig.a, sig.b, sig.x), sig.nextOffset)
        case 0x149: // setiosys
            sig = decodeFunctionSignature_in_in(image, offset)
            return new ParseResult(g.setiosys(sig.a, sig.b), sig.nextOffset)
        case 0x160: // callf
            sig = decodeFunctionSignature_in_out(image, offset)
            return new ParseResult(g.callf(sig.a, [], sig.out), sig.nextOffset)
        case 0x161: // callfi
            sig = decodeFunctionSignature_in_in_out(image, offset)
            return new ParseResult(g.callf(sig.a, [sig.b], sig.x), sig.nextOffset)
        case 0x162: // callfii
            sig = decodeFunctionSignature_in_in_in_out(image, offset)
            return new ParseResult(g.callf(sig.a, [sig.b, sig.c], sig.x), sig.nextOffset)
        case 0x163: // callfiii
            sig = decodeFunctionSignature_in_in_in_in_out(image, offset)
            return new ParseResult(g.callf(sig.a, [sig.b, sig.c, sig.d], sig.x), sig.nextOffset)

        default:
            throw new Error(`unknown opcode ${opcode} at ${offset}`)
    }
}

// decodes a sequence of opcodes until either a Return or Jump is reached
// or the endOffset is reached
function decodeOpcodes(image: Uint8Array, offset: number, endOffset: number): ParseResult<Opcode[]> {
    let opcodes: Opcode[] = []
    while (offset < endOffset) {
        let opcode = decodeOpcode(image, offset)
        opcode.v.offset = offset
        opcodes.push(opcode.v)
        offset = opcode.nextOffset
        if (opcode.v instanceof Return) {
            break
        }
        if (opcode.v instanceof Jump) {
            break
        }
    }
    return new ParseResult(opcodes, offset);
}

const THE_END = 0xFFFFFFFF

export function decodeFunction(image: Uint8Array, offset: number, name?: string): ParseResult<GlulxFunction> {
    const callType = image[offset]
    const funcOffset = offset
    let stackCalled = false
    let localsCount = 0
    switch (callType) {
        case 0xC0: stackCalled = true
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
                localsCount = argCount

                if (stackCalled) {
                    ftype = types.out
                }
                else switch (argCount) {
                    // TODO: how to differentiate between arguments and local parameters ?
                    // probably need to 0-pad at the call-site
                    case 0: ftype = types.out; break;
                    case 1: ftype = types.in_out; break;
                    case 2: ftype = types.in_in_out; break;
                    case 3: ftype = types.in_in_in_out; break;
                    default: throw new Error("unsupported number of arguments: " + argCount)
                }

            }
            let bodyStart = decodeOpcodes(image, offset, THE_END)

            // look at all conditional jumps, and try to replace them with some "pattern"
            let condJumps = bodyStart.v.filter(op => op instanceof ConditionalJump) as ConditionalJump[]
            if (condJumps.length > 0) {
                bodyStart = fixupConditionalJumps(image, bodyStart, condJumps)
            }
            // the block needs to end with a return
            // sometimes there are dynamic non-conditional jumps that actually return, followed
            // by a dummy or fallthrough return
            bodyStart = fixupFinalReturn(image, bodyStart)
            let lastOp = bodyStart.v[bodyStart.v.length - 1]

            if (lastOp instanceof Return) {
                return new ParseResult(new GlulxFunction(funcOffset, name || ("_" + funcOffset.toString()),
                    ftype, stackCalled, localsCount, bodyStart.v), bodyStart.nextOffset)
            }

            console.error("function body does not end in Return", lastOp, bodyStart)
            throw new Error("function body does not end in Return")
    }
}

function fixupFinalReturn(image: Uint8Array, block: ParseResult<Opcode[]>): ParseResult<Opcode[]> {
    // if it ends with a return, we are good
    let lastOp = block.v[block.v.length - 1]
    if (lastOp instanceof Jump) {
        const ret = lastOp.getConstantReturnValue()
        if (ret != null) {
            block.v.pop()
            block.v.push(ret)
            return block
        } else {
            // maybe the next one is a return?
            let nextOp = decodeOpcode(image, block.nextOffset)
            if (nextOp.v instanceof Return) {
                lastOp = nextOp.v
                block.v.push(lastOp)
                return {
                    v: block.v,
                    nextOffset: nextOp.nextOffset
                }
            }
        }
    }
    return block
}

function fixupConditionalJumps(image: Uint8Array, block: ParseResult<Opcode[]>, condJumps: ConditionalJump[]): ParseResult<Opcode[]> {
    for (let condJump of condJumps) {
        let vector = condJump.vector
        if (vector instanceof Constant) {
            let jump = vector.v
            if (jump >= 0) {
                if (jump < 3) {
                    // return or nop, do nothing, the runtime can handle it
                } else {
                    // forward jump: decode the block where it goes to
                    const indexOfJump = block.v.indexOf(condJump)
                    const condJumpNextOffset = block.v[indexOfJump + 1].offset
                    let thenBlock = decodeOpcodes(image, jump + condJumpNextOffset - 2, THE_END)
                    let nestedConds = thenBlock.v.filter(op => op instanceof ConditionalJump) as ConditionalJump[]
                    if (nestedConds.length > 0) {
                        thenBlock = fixupConditionalJumps(image, thenBlock, nestedConds)
                    }
                    // assume the then returns. Then we don't need "else"
                    thenBlock = fixupFinalReturn(image, thenBlock)
                    let lastOp = thenBlock.v[thenBlock.v.length - 1]
                    if (lastOp instanceof Return) {
                        // loop back to the conditional at the end of "else" ? That would be a while loop
                        lastOp = block.v[block.v.length - 1]
                        if (lastOp instanceof Jump &&
                            lastOp.getConstantJumpTarget(block.nextOffset) == condJump.offset) {
                            // remove the jump, let it loop
                            console.info("WHILE", lastOp, condJump, block, thenBlock)
                            block.v.pop()
                            block.v.splice(indexOfJump, block.v.length - indexOfJump, new WhileLoop(condJump, block.v.slice(indexOfJump + 1)))
                            block.v.push(...thenBlock.v)
                        } else {
                            // just replace the conditional jump with If-then
                            block.v[indexOfJump] = new IfThenElse(condJump, thenBlock.v, [])
                        }
                    } else {
                        throw new Error("thenBlock did not end in Return")
                    }
                }
            } else {
                console.error("got a conditional jump backwards, only forward jumps are supported", condJump)
                throw new Error("got a conditional jump backwards, only forward jumps are supported")
            }
        } else {
            console.error("got a dynamic jump vector on a conditional jump", condJump)
            throw new Error("got a dynamic jump vector on a conditional jump")
        }
    }

    return block
}