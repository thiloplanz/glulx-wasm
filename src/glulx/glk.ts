// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/

// A dummy GLK implementation

import { GLK, VmLibSupport, GlkSelector } from './host'

export let OutputBuffer = ""

export const DummyGLK: GLK = {

    put_char: function (latin1) {
        OutputBuffer += String.fromCharCode(latin1)
    }
}

export function ClearOutputBuffer() { OutputBuffer = "" }



