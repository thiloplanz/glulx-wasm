// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/

// String handling functions, in particular decoding compressed Strings and assembling the String segment

import { uint32, uint7 } from '../basic-types'
import { TranscodingContext, Opcode, Expression, Constant, read_uint32 } from './ast'
import { vmlib_call } from './vmlib'
import { Op, Void, c } from '../ast'

/**
 * Returns vmlib_calls that can be used to output the string (using streamchar and stream_buffer)  
 */
function streamString(context: TranscodingContext, addr: uint32): Op<Void> {
    // inline access to Strings that are completely in ROM
    if (addr < context.ramStart) {
        const type = context.image[addr]
        switch (type) {
            case 0xE0:
                let end = addr + 1
                while (context.image[end] > 0) end++
                let length = end - addr - 1
                if (length == 0) return c.nop
                if (end <= context.ramStart)
                    return vmlib_call.stream_buffer(c.i32.const(addr + 1), c.i32.const(length))
                break;
            case 0xE1:
                // decode assuming the default string table
                let decoded = decodeString(context, read_uint32(context.image, context.stringTbl + 8), addr + 1, 0)
                // then check if runtime if the table hasn't changed
                // TODO: global variable for current decoding table
                return c.if(c.void_, c.i32.eq(c.i32.const(context.stringTbl), c.i32.const(context.stringTbl)),
                    decoded, [c.unreachable])

            default: throw new Error("unsupported String type " + type)
        }
    }
    throw new Error("dynamic or RAM streamstr not yet implemented")
}

function decodeString(context: TranscodingContext, nodeAddr: uint32, nextByte: uint32, nextBit: uint7): Op<Void>[] {
    if (nodeAddr >= context.ramStart)
        throw new Error("string table spilt outside of ROM!")
    const { image } = context
    const nodeType = image[nodeAddr]
    if (nextBit > 7) {
        nextByte++
        nextBit = 0
    }
    let bit
    let char
    let rest: Op<Void>[]
    switch (nodeType) {
        case 0x00: // branch
            bit = (image[nextByte] >> nextBit) & 0x01
            return decodeString(context, read_uint32(image, nodeAddr + (bit ? 5 : 1)), nextByte, nextBit + 1)
        case 0x01: // end of string
            return []
        case 0x02: // single character
            char = image[nodeAddr + 1]
            rest = decodeString(context, read_uint32(context.image, context.stringTbl + 8), nextByte, nextBit)
            rest.unshift(vmlib_call.streamchar(c.i32.const(char)))
            return rest
        default:
            throw new Error("unsupported string table node type " + nodeType + " at " + nodeAddr)
    }
}

export class StreamStr implements Opcode {
    constructor(private readonly addr: Expression) { }
    transcode(context: TranscodingContext) {
        const { addr } = this
        if (addr instanceof Constant) {
            return streamString(context, addr.v)
        }
        throw new Error("dynamic or RAM streamstr not yet implemented")
    }
}
