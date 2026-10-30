/** @param {unknown} value */
export function pdfLayoutPort(value=3021){
 if((typeof value!=='number'&&typeof value!=='string')||!/^\d+$/.test(String(value)))throw new RangeError('PDF layout port must be an integer between 1 and 65535.');
 const port=Number(value);
 if(!Number.isInteger(port)||port<1||port>65535)throw new RangeError('PDF layout port must be an integer between 1 and 65535.');
 return port;
}
