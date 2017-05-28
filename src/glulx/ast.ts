// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/


// AST for Glulx functions

import { c, sect_id, N, I32, Void, Op, FunctionBody, FuncType, VarUint32, Module, AnyResult, AnyOp } from '../ast'
import { uint32 } from '../basic-types'
import { vmlib_call, types, SP, STACK_POINTER, GETENDMEM } from './vmlib'
import { GlkSelector } from './host'
import { StreamStr } from './strings'


export interface TranscodingContext {
    callableFunctions: VarUint32[],
    stackCalledFunctions: boolean[],
    image: Uint8Array,
    ramStart: uint32,
    endMem: uint32,
    stringTbl: uint32,
    currentFunctionLocalsCount: uint32
}

export interface Transcodable {
    transcode(context: TranscodingContext): N
}

/**
 * We break up the Glulx opcodes into two parts:
 * an Expression (that usually requires load operands)
 * and a Store (which usually requires a store operand).
 * 
 * That way, we can re-use the Expression part to build
 * more complex, nested expressions (which is something 
 * the WebAssembly allows for). For example, we can put
 * a complex Expression where a load operand is required
 * (care must be taken about execution order and side-effects)
 * 
 * Note that Expressions do not have to be "pure"
 * (i.e. they can be indetermistic and have side effects)
 * 
 * Expressions all return an I32
 */

export interface Expression extends Transcodable {
    transcode(context: TranscodingContext): Op<I32>
}


export interface Opcode extends Transcodable {
    offset?: uint32    // if decoded from an image, the offset of this opcode
    transcode(context: TranscodingContext): AnyOp
}

/**
 * The "basic opcode" takes an Expression and a store operand.
 * It evaluates the expression and stores it.
 * That way, things like Add become more reusable in the form of an Expression
 */
class BasicOpcode implements Opcode {
    constructor(private readonly expression: Expression, private readonly store: StoreOperandType) { }
    transcode(context) { return this.store.transcode(context, this.expression) }
}

/**
 * wrap a native (WASM) expression. This will be generated to implement some of the
 * more low-level opcodes with inline assembly (as opposed to a VMlib call)
 */

class NativeExpression implements Expression {
    constructor(private readonly expression: Op<I32>) { }
    transcode() { return this.expression }
}

export interface StoreOperandType {
    transcode(context: TranscodingContext, input: Expression): Op<Void>
}

export class GlulxFunction {
    constructor(
        readonly address: uint32,
        readonly name: string,
        readonly type: FuncType,
        readonly stackCalled: Boolean,
        readonly localsCount: uint32,
        readonly opcodes: Opcode[]) { }
}

export class Return implements Opcode {
    constructor(readonly expression: Expression) { }
    transcode(context) { return c.return_(this.expression.transcode(context)) }
}

class NativeCallExpression implements Expression {
    constructor(private readonly functionIndex: VarUint32, private readonly args: Expression[]) { }
    transcode(context) { return c.call(c.i32, this.functionIndex, this.args.map(x => x.transcode(context))) }
}

class Callf implements Opcode {
    constructor(private readonly address: Expression, private readonly args: Expression[], private readonly result: StoreOperandType) { }
    transcode(context: TranscodingContext) {
        const { address, args, result } = this
        if (address instanceof Constant) {
            const index = context.callableFunctions[address.v]
            if (!index) {
                console.error("unknown function being called", address, context)
                return c.unreachable
            }
            if (context.stackCalledFunctions[address.v]) {
                console.info(index, context.currentFunctionLocalsCount)
                return c.void_block(
                    // push args in reverse order
                    args.slice().reverse().map(x => vmlib_call.push(x.transcode(context)))
                        .concat(
                        // set called_frame_pointer
                        c.set_local(context.currentFunctionLocalsCount + 0, c.i64.extend_u_i32(SP)),
                        // push arg count
                        vmlib_call.push(c.i32.const(args.length)),
                        // make the call
                        result.transcode(context, new NativeCallExpression(index, [])),
                        // clean up the stack (call args should have been removed)
                        c.set_global(STACK_POINTER, c.i32.wrap_i64(c.get_local(c.i64, context.currentFunctionLocalsCount + 0)))
                        )
                )
            }
            return c.void_block([
                // set called_frame_pointer
                c.set_local(context.currentFunctionLocalsCount + 0, c.i64.extend_u_i32(SP)),
                // make the call
                result.transcode(context, new NativeCallExpression(index, args)),
                // clean up the stack (call args should have been removed)
                c.set_global(STACK_POINTER, c.i32.wrap_i64(c.get_local(c.i64, context.currentFunctionLocalsCount + 0)))
            ])
        }
        return c.unreachable /* dynamic calls are not implemented */
    }
}

class GlkCallExpression implements Expression {
    constructor(private readonly selector: Expression, private readonly argc: Expression) { }
    transcode(context) { return vmlib_call.glk(this.selector.transcode(context), this.argc.transcode(context)) }
}



export class GlkCall implements Opcode {
    constructor(private readonly selector: Expression, private readonly argc: Expression, private readonly result: StoreOperandType) { }
    transcode(context: TranscodingContext) {
        const { selector, argc, result } = this
        // we pass this out to Javascript to dispatch (and get the parameters from the stack)
        return result.transcode(context, new GlkCallExpression(selector, argc))
    }
}

class VmLibCall implements Opcode {
    constructor(private readonly call: (...args: Op<I32>[]) => Op<AnyResult>, private readonly args: Expression[], private readonly result: StoreOperandType) { }
    transcode(context: TranscodingContext) {
        const args = this.args.map(x => x.transcode(context))
        if (this.result == null) {
            // for "void" functions
            return this.call.apply(null, args)
        } else {
            return this.result.transcode(context, this.call.apply(null, args))
        }
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

export class Jump implements Opcode {
    constructor(private readonly v: Expression) { }
    transcode(context) {
        const v = this.v
        // optimization for constant jump vectors
        if (v instanceof Constant) {
            if (v.v == 0) return return_zero
            if (v.v == 1) return return_one
            if (v.v == 2) return c.nop
            console.error("actual jumps are not implemented, cannot go to " + v.v)
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
    getConstantJumpTarget(baseAddress: uint32): uint32 {
        const { v } = this
        if (v instanceof Constant) {
            if (v.v == 0) return null
            if (v.v == 1) return null
            return baseAddress + v.v - 2
        }
        return null
    }
    getConstantReturnValue(): Return {
        const { v } = this
        if (v instanceof Constant) {
            if (v.v == 0) return new Return(v)
            if (v.v == 1) return new Return(v)
        }
        return null
    }
}

export class ConditionalJump implements Opcode {
    constructor(private readonly comp: ((args: Op<I32>[]) => Op<I32>), private readonly args: Expression[], readonly vector: Expression) { }
    offset: uint32
    transcode(context) {
        const { vector } = this
        const cond = this.transcodeCondition(context)
        const jump = new Jump(vector).transcode(context)
        const x = c.if_(c.void, cond, [jump])
        return x
    }
    transcodeCondition(context): Op<I32> {
        const { comp, args, vector } = this
        const _args = args.map(x => x.transcode(context))
        return comp.apply(null, _args)
    }
}

class Add implements Expression {
    constructor(private readonly a: Expression, private readonly b: Expression) { }
    transcode(context) { return c.i32.add(this.a.transcode(context), this.b.transcode(context)) }
}

class Sub implements Expression {
    constructor(private readonly a: Expression, private readonly b: Expression) { }
    transcode(context) { return c.i32.sub(this.a.transcode(context), this.b.transcode(context)) }
}

class Mul implements Expression {
    constructor(private readonly a: Expression, private readonly b: Expression) { }
    transcode(context) { return c.i32.mul(this.a.transcode(context), this.b.transcode(context)) }
}

class Div implements Expression {
    constructor(private readonly a: Expression, private readonly b: Expression) { }
    transcode(context) { return c.i32.div_s(this.a.transcode(context), this.b.transcode(context)) }
}

class Mod implements Expression {
    constructor(private readonly a: Expression, private readonly b: Expression) { }
    transcode(context) { return c.i32.rem_s(this.a.transcode(context), this.b.transcode(context)) }
}

class Neg implements Expression {
    constructor(private readonly a: Expression) { }
    transcode(context) { return c.i32.sub(zero, this.a.transcode(context)) }
}

class BitAnd implements Expression {
    constructor(private readonly a: Expression, private readonly b: Expression) { }
    transcode(context) { return c.i32.and(this.a.transcode(context), this.b.transcode(context)) }
}

class UShiftR implements Expression {
    constructor(private readonly a: Expression, private readonly b: Expression) { }
    transcode(context) { return c.i32.shr_u(this.a.transcode(context), this.b.transcode(context)) }
}

export class Constant implements Expression {
    constructor(readonly v: uint32) { }
    transcode() { return c.i32.const(this.v) }
}


export function read_uint16(image: Uint8Array, offset: number) {
    return image[offset] * 256 + image[offset + 1]
}

export function read_uint32(image: Uint8Array, offset: number) {
    return image[offset] * 0x1000000 + image[offset + 1] * 0x10000 + image[offset + 2] * 0x100 + image[offset + 3]
}

class MemoryAccess implements Expression {
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
    transcode(context: TranscodingContext, input: Expression): Op<Void> {
        return vmlib_call.store_uint32(c.i32.const(this.addr), input.transcode(context))
    }
}

class RAMAccess implements Expression {
    constructor(readonly address: uint32) { }
    transcode(context: TranscodingContext): Op<I32> {
        return vmlib_call.read_uint32(c.i32.const(this.address + context.ramStart))
    }
}

class RAMStore implements StoreOperandType {
    constructor(private readonly address: uint32) { }
    transcode(context: TranscodingContext, input: Expression): Op<Void> {
        return vmlib_call.store_uint32(c.i32.const(this.address + context.ramStart), input.transcode(context))
    }
}

class Pop implements Expression {
    transcode(): Op<I32> { return vmlib_call.pop }
}

class Push implements StoreOperandType {
    transcode(context: TranscodingContext, input: Expression): Op<Void> { return vmlib_call.push(input.transcode(context)) }
}

class Local32 implements Expression {
    constructor(private readonly v: uint32) { }
    transcode() { return c.get_local(c.i32, this.v) }
}

class StoreLocal32 implements StoreOperandType {
    constructor(private readonly v: uint32) { }
    transcode(context: TranscodingContext, input: Expression) { return c.set_local(this.v, input.transcode(context)) }
}

class Discard implements StoreOperandType {
    transcode(context: TranscodingContext, input: Expression) { return c.drop(c.void_, input.transcode(context)) }
}

class ReadUInt8 implements Expression {
    constructor(private readonly addr: Expression) { }
    transcode(context: TranscodingContext) { return vmlib_call.read_uint8(this.addr.transcode(context)) }
}

class ReadUInt16 implements Expression {
    constructor(private readonly addr: Expression) { }
    transcode(context: TranscodingContext) { return vmlib_call.read_uint16(this.addr.transcode(context)) }
}

class ReadUInt32 implements Expression {
    constructor(private readonly addr: Expression) { }
    transcode(context: TranscodingContext) { return vmlib_call.read_uint32(this.addr.transcode(context)) }
}

const discard: StoreOperandType = new Discard

const pop: Expression = new Pop

const push: StoreOperandType = new Push

const _jz = c.i32.eqz.bind(c.i32)

const _jeq = c.i32.eq.bind(c.i32)

const _jne = c.i32.ne.bind(c.i32)

const _jge = c.i32.ge_s.bind(c.i32)

const _jgeu = c.i32.ge_u.bind(c.i32)

const _jleu = c.i32.le_u.bind(c.i32)

const _jlt = c.i32.lt_s.bind(c.i32)

const _jgt = c.i32.gt_s.bind(c.i32)

const _jle = c.i32.le_s.bind(c.i32)

const eins = new Constant(1)

const acht = new Constant(8)

export const g = {
    const_(v: uint32): Constant { return new Constant(v) },

    memory(address: uint32): Expression { return new MemoryAccess(address) },

    ram(address: uint32): Expression { return new RAMAccess(address) },

    pop: pop,

    push: push,

    discard: discard,

    localVariable(index: uint32): Expression {
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

    add(a: Expression, b: Expression, x: StoreOperandType): Opcode { return new BasicOpcode(new Add(a, b), x) },

    sub(a: Expression, b: Expression, x: StoreOperandType): Opcode { return new BasicOpcode(new Sub(a, b), x) },

    mul(a: Expression, b: Expression, x: StoreOperandType): Opcode { return new BasicOpcode(new Mul(a, b), x) },

    div(a: Expression, b: Expression, x: StoreOperandType): Opcode { return new BasicOpcode(new Div(a, b), x) },

    neg(a: Expression, x: StoreOperandType): Opcode { return new BasicOpcode(new Neg(a), x) },

    bitand(a: Expression, b: Expression, x: StoreOperandType): Opcode { return new BasicOpcode(new BitAnd(a, b), x) },

    ushiftr(a: Expression, b: Expression, x: StoreOperandType): Opcode { return new BasicOpcode(new UShiftR(a, b), x) },

    copy(a: Expression, x: StoreOperandType): Opcode { return new BasicOpcode(a, x) },

    return_(v: Expression): Opcode { return new Return(v) },

    callf(address: Expression, args: Expression[], result: StoreOperandType): Opcode {
        if (args.length > 3) throw new Error(`callf does not take more than three arguments, you gave me ${args.length}`)
        return new Callf(address, args, result)
    },

    glk: {
        put_char: function (latin1: Expression) {
            return [
                g.copy(latin1, g.push),
                new GlkCall(g.const_(GlkSelector.put_char), g.const_(1), g.discard)
            ]
        },
        put_buffer: function (offset: Expression, length: Expression) {
            return [
                g.copy(length, g.push),
                g.copy(offset, g.push),
                new GlkCall(g.const_(GlkSelector.put_buffer), g.const_(2), g.discard)
            ]
        }

    },

    streamchar(n: Expression): Opcode { return new VmLibCall(vmlib_call.streamchar, [n], null) },

    streamnum(n: Expression): Opcode { return new VmLibCall(vmlib_call.streamnum, [n], null) },

    streamstr(addr: Expression): Opcode { return new StreamStr(addr) },

    streamunichar(n: Expression): Opcode { return new VmLibCall(vmlib_call.streamunichar, [n], null) },

    setiosys(sys: Expression, rock: Expression): Opcode { return new VmLibCall(vmlib_call.setiosys, [sys, rock], null) },

    getmemsize(out: StoreOperandType): Opcode { return new BasicOpcode(new NativeExpression(GETENDMEM), out) },

    jump(v: Expression): Opcode { return new Jump(v) },

    jz(condition: Expression, vector: Expression): Opcode {
        return new ConditionalJump(_jz, [condition], vector)
    },

    jnz(condition: Expression, vector: Expression): Opcode {
        return new ConditionalJump(_jne, [condition, new NativeExpression(zero)], vector)
    },

    jeq(a: Expression, b: Expression, vector: Expression): Opcode {
        return new ConditionalJump(_jeq, [a, b], vector)
    },

    jne(a: Expression, b: Expression, vector: Expression): Opcode {
        return new ConditionalJump(_jne, [a, b], vector)
    },

    jge(a: Expression, b: Expression, vector: Expression): Opcode {
        return new ConditionalJump(_jge, [a, b], vector)
    },

    jgeu(a: Expression, b: Expression, vector: Expression): Opcode {
        return new ConditionalJump(_jgeu, [a, b], vector)
    },

    jleu(a: Expression, b: Expression, vector: Expression): Opcode {
        return new ConditionalJump(_jleu, [a, b], vector)
    },

    jlt(a: Expression, b: Expression, vector: Expression): Opcode {
        return new ConditionalJump(_jlt, [a, b], vector)
    },

    jgt(a: Expression, b: Expression, vector: Expression): Opcode {
        return new ConditionalJump(_jgt, [a, b], vector)
    },
    jle(a: Expression, b: Expression, vector: Expression): Opcode {
        return new ConditionalJump(_jle, [a, b], vector)
    },

    aload(a: Expression, i: Expression, out: StoreOperandType): Opcode {
        const indx = new Mul(i, new Constant(4))
        const addr = new Add(a, indx)
        return new BasicOpcode(new ReadUInt32(addr), out)
    },

    aloads(a: Expression, i: Expression, out: StoreOperandType): Opcode {
        return new BasicOpcode(new ReadUInt8(new Add(a, new Add(i, i))), out)
    },

    aloadb(a: Expression, i: Expression, out: StoreOperandType): Opcode {
        return new BasicOpcode(new ReadUInt8(new Add(a, i)), out)
    },

    aloadbit(a: Expression, i: Expression, out: StoreOperandType): Opcode {
        let byteOffset = new Add(a, new Div(i, acht))
        let bitIndex = new Mod(i, acht)
        let readByte = new ReadUInt8(byteOffset)
        return new BasicOpcode(new BitAnd(eins, new UShiftR(readByte, bitIndex)), out)
    },

    function_i32_i32(address: uint32, name: string, opcodes: Opcode[]): GlulxFunction {
        return new GlulxFunction(address, name, types.in_out, false, 1, opcodes)
    },

    function_i32_i32_i32(address: uint32, name: string, opcodes: Opcode[]): GlulxFunction {
        return new GlulxFunction(address, name, types.in_in_out, false, 2, opcodes)
    },

    trap(message: string): Opcode {
        console.error(message)
        return new BasicOpcode(eins, discard)
    }
}
