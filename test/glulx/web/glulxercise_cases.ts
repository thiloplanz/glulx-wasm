// Written in 2017 by Thilo Planz
// To the extent possible under law, I have dedicated all copyright and related and neighboring rights 
// to this software to the public domain worldwide. This software is distributed without any warranty. 
// http://creativecommons.org/publicdomain/zero/1.0/

// Test cases derived from the glulxercise "game" image




// format is [ case name, function offset, (input, expectedReturnValue, expectedPrintOutput)* ]

export const test_cases: any[][] = [
    [
        "_0x0000707c__return false",
        0x707c,
        [], 0, null
    ],
    [
        "_0x00007084__return true",
        0x7084,
        [], 1, null
    ],
    [
        "_0x0000708d__return input",
        0x708d,
        0, 0, null,
        1, 1, null
    ],
    [
        "_0x00007098__return false",
        0x7098,
        0, 0, null,
        1, 0, null,
    ],
    [
        "_0x000070a6__return true",
        0x70a6,
        0, 1, null,
        1, 1, null,
    ],
    [
        "_0x000070b5__jump_table",
        0x70b5,
        0, 0, null,
        1, 1, null,
        2, 2, null,
        5, 3, null
    ],
    [
        "_0x000070eb__jz",
        0x70eb,
        0, 0, null,
        1, 99, null
    ],
    [
        "_0x000070f6__jz",
        0x70f6,
        0, 1, null,
        42, 99, null
    ],
    [
        "_0x00009cbd__streamchar",
        0x9cbd,
        0, 1, "#.",
    ],
    [
        "_0x00000e52__streamstr",
        0x0e52,
        [], 1, "Nothing happens.\n",
    ],
    [
        "_0x0000a022__setiosys",
        0xa022,
        88, 1, "<X>"  // 88 => X
    ],
    [
        "_0x0000097f__if_then_else_return",
        0x097f,
        [0, 0], 1, "0",
        [1, 1], 1, "1",
        [2, 3], 0, "2 (should be 3 FAIL)"
    ]
]