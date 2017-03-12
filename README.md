# glulx-wasm

[Glulx](http://en.wikipedia.org/wiki/Glulx) is a specification for a 32-bit virtual machine that runs Inform 6 and [Inform 7 story files](http://inform7.com).

This project is an attempt (still in its infancy) to cross-compile Glulx bytecode to WebAssembly.

It makes use of the excellent [wasm-util](https://github.com/rsms/wasm-util/) library by Rasmus Andersson, which provides a Typescript-based toolchain to work with WebAssembly. This means that you can play with this without the rather complex official  wasm tooling, all you need is a recent version of Typescript (and experimental browser builds).

### What can this do?

Not much yet...

There is a unit test to look at, which takes an AST with a sequence of Glulx operations, transforms it into a WASM-AST, emits that into a WASM binary, instantiates it as a module in your browser, calls the exported functions and asserts their result.

1. Get Chrome Canary and open `chrome://flags/#enable-webassembly`  (if you can get this to work in any other browser let me know)
2. compile the tests with `cd test/glulx; npm start`
3. go to `http://localhost:3000/web/index.html` to run the tests, see if everything is green
4. You can take a look at the compiled module in the Chrome Developer Tools: Go to the "Sources" tab, there should be a section called "wasm"


### Memory layout

The Glulx virtual machine memory is mapped directly to the WASM module's default linear memory.

That means that ROM starts at address 0 and RAM starts at the specified RAMSTART.
After that come the regions for the managed heap (TODO) and the stack.

A little complication occurs when reading values from mapped memory because Glulx uses a big-endian format 
whereas the WASM opcodes expect little-endian. The runtime library provides for conversion functions
that the compiled code calls into (TODO).

### Global variables

The runtime support library makes use of some WASM global variables to keep track of state:

```
0:   Stack segment offset, immutable
1:   Stack pointer, mutable
```
