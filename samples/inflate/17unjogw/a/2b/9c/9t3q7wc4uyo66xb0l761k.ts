const LBASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
const LEBITS = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
const DBASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
const DEBITS = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];

// Deflate RFC 1951 symbol encoding helpers and the code-length alphabet order.
export const deflateSyms = {
  // Order in which code-length code lengths are written in a dynamic block header.
  CL_ORDER: [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15] as number[],

  // Map a back-reference length (3–258) to [lengthSymbol, extraBits, extraValue].
  lenSym(length: number): [number, number, number] {
    for (let i = 28; i >= 0; i--) {
      if (length >= LBASE[i]) return [257 + i, LEBITS[i], length - LBASE[i]];
    }
    return [257, 0, 0];
  },

  // Map a back-reference distance (1–32768) to [distCode, extraBits, extraValue].
  distSym(dist: number): [number, number, number] {
    for (let i = 29; i >= 0; i--) {
      if (dist >= DBASE[i]) return [i, DEBITS[i], dist - DBASE[i]];
    }
    return [0, 0, 0];
  },

  // Decode: given a length symbol (257–285), return [baseLength, extraBits].
  lenBase(sym: number): [number, number] {
    const i = sym - 257;
    return [LBASE[i], LEBITS[i]];
  },

  // Decode: given a distance code (0–29), return [baseDist, extraBits].
  distBase(code: number): [number, number] {
    return [DBASE[code], DEBITS[code]];
  },
};