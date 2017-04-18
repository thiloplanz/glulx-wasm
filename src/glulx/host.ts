// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/

// Interface that a host that embeds the game image has to provide
// (functions for the game to call into to talk to the outside world)
// and functions for the host to access game state data

import { uint32 } from '../basic-types'

export interface VmLibSupport {
    glk(selector: uint32, argc: uint32): uint32
}

/**
 * All these functions will be called with `this` set to the GlulxAccess instance
 */
export interface GLK {
    put_char(latin1: uint32);
    put_buffer(offset: uint32, length: uint32);
}

export const enum GlkSelector {
    put_char = 0x80,
    put_buffer = 0x84
}


export class GlulxAccess {
    constructor(readonly instance, readonly _glk: GLK) { }

    getMemory(): Uint8Array {
        return new Uint8Array(this.instance.exports.memory.buffer)
    }

    popFunctionArgumentsFromStack(count): uint32[] {
        const args = []
        const { _pop } = this.instance.exports
        for (let i = 0; i < count; i++) {
            args.push(_pop())
        }
        return args
    }

    callStackCalledFunction(func: Function, args: uint32[]): uint32 {
        const { _push } = this.instance.exports
        if (args.length == 0) {
            _push(0)
        } else {
            args = args.slice().reverse()
            args.forEach(x => _push(x))
            _push(args.length)
        }
        return func()
    }

    glk(selector, argc): uint32 {
        switch (selector) {
            case GlkSelector.put_char:
                return this._glk.put_char.call(this, this.popFunctionArgumentsFromStack(1)[0] & 0xFF)
            case GlkSelector.put_buffer:
                return this._glk.put_buffer.apply(this, this.popFunctionArgumentsFromStack(2))
            default:
                console.error(`unknown GLK selector ${selector}`)
                return 0
        }
    }
}