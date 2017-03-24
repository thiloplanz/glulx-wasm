// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/

// A dummy GLK implementation

import { GLK, VmLibSupport, GlkSelector, GlulxAccess } from './host'

export let OutputBuffer = ""

declare const TextDecoder: any

const latin1decoder = new TextDecoder("latin1")

export const DummyGLK: GLK = {

    put_char: function (latin1) {
        OutputBuffer += String.fromCharCode(latin1)
    },

    put_buffer: function (offset, length) {
        const glulx = this as GlulxAccess
        OutputBuffer += latin1decoder.decode(glulx.getMemory().subarray(offset, offset + length))
    }
}

export function ClearOutputBuffer() { OutputBuffer = "" }



