// Continuous noise: no repeated recording or loop seam. Pink filter based on
// Paul Kellet's economical approximation; brown noise uses a leaky integrator.
export class NoiseGenerator {
  constructor(kind = 'brown') { this.kind = kind; this.b = new Float64Array(7); this.last = 0; }
  next(random = Math.random) {
    const white = random() * 2 - 1;
    if (this.kind === 'white') return white * .35;
    if (this.kind === 'brown') {
      this.last = (this.last + .02 * white) / 1.02;
      return this.last * 3.5;
    }
    const b = this.b;
    b[0] = .99886 * b[0] + white * .0555179;
    b[1] = .99332 * b[1] + white * .0750759;
    b[2] = .969 * b[2] + white * .153852;
    b[3] = .8665 * b[3] + white * .3104856;
    b[4] = .55 * b[4] + white * .5329522;
    b[5] = -.7616 * b[5] - white * .016898;
    const pink = (b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + white * .5362) * .11;
    b[6] = white * .115926;
    return pink;
  }
}

if (typeof registerProcessor === 'function') {
  class LumiorNoise extends AudioWorkletProcessor {
    constructor(options) {
      super();
      this.generators = [new NoiseGenerator(options.processorOptions.kind), new NoiseGenerator(options.processorOptions.kind)];
      this.active = true;
      this.port.onmessage = () => { this.active = false; };
    }
    process(_inputs, outputs) {
      if (!this.active) return false;
      outputs[0].forEach((channel, index) => {
        const generator = this.generators[index];
        for (let i = 0; i < channel.length; i++) channel[i] = generator.next();
      });
      return true;
    }
  }
  registerProcessor('lumior-noise', LumiorNoise);
}
