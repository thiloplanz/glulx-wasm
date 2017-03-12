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

export interface GLK {
    put_char(latin1: number);
}

export const enum GlkSelector {
    put_char = 0x80
}


export class GlulxAccess {
    constructor(readonly instance, readonly _glk: GLK) { }

    getMemory(): Uint8Array {
        return new Uint8Array(this.instance.exports.memory.buffer)
    }

    popFunctionArgumentsFromStack(count): uint32[] {
        const args = []
        const _pop = this.instance.exports._pop
        for (let i = 0; i < count; i++) {
            args.push(_pop())
        }
        return args
    }

    glk(selector, argc): uint32 {
        switch (selector) {
            case GlkSelector.put_char:
                return this._glk.put_char(this.popFunctionArgumentsFromStack(1)[0] & 0xFF)
            default:
                console.error(`unknown GLK selector ${selector}`)
                return 0
        }
    }
}