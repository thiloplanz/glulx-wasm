# glulx-wasm

[Glulx](http://en.wikipedia.org/wiki/Glulx) is a specification for a 32-bit virtual machine that runs Inform 6 and [Inform 7 story files](http://inform7.com).

This project is an attempt (still in its infancy) to cross-compile Glulx bytecode to WebAssembly.

It makes use of the excellent [wasm-util](https://github.com/rsms/wasm-util/) library by Rasmus Andersson, which provides a Typescript-based toolchain to work with WebAssembly. This means that you can play with this without the rather complex official  wasm tooling, all you need is a recent version of Typescript (and experimental browser builds).

### What can this do?

Not much yet...

There is a unit test to look at, which takes an AST with a sequence of Glulx operations, transforms it into a WASM-AST, emits that into a WASM binary, instantiates it as a module in your browser, calls the exported functions and asserts their result.

1. Get Chrome Canary and open `chrome://flags/#enable-webassembly`  (if you can get this to work in any other browser let me know)
2. compile the tests `cd test/glulx/web; tsc`
3. `open index.html` to run the tests, see if everything is green
4. You can take a look at the compiled module in the Chrome Developer Tools: Go to the "Sources" tab, there should be a section called "wasm"
