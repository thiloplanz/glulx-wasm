// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/


// Wrap the glulxercise.ulx file into a WASM module,
// along with ahead-of-time compiled game functions


import fs = require("fs")

import { module } from "../../../src/glulx/module"
import { decodeFunction } from "../../../src/glulx/decoder"
import { BufferedEmitter } from "../../../src/emit"

import { test_cases } from "../web/glulxercise_cases"

let buffer = fs.readFileSync("../glulxercise.ulx").buffer;
let image = new Uint8Array(buffer)
let mod = module(test_cases.map(x => decodeFunction(image, x[1], x[0]).v), image, 0x00027600, 0x0002b200, 0x0001c9a6)

const wasm = new ArrayBuffer(2 * 1024 * 1024)
const emitter = new BufferedEmitter(wasm)
mod.emit(emitter)


fs.writeFileSync("../web/build/glulxercise.wasm", new Buffer(wasm.slice(0, emitter.length)))
