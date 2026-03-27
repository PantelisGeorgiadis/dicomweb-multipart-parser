const StreamSearch = require('./../src/StreamSearch');

const chai = require('chai');
const expect = chai.expect;

function collect(needle, chunks) {
  const results = [];
  const ss = new StreamSearch(Buffer.from(needle), (isMatch, data, start, end) => {
    results.push([isMatch, data ? data.toString('latin1', start, end) : null]);
  });
  for (const chunk of chunks) {
    ss.push(Buffer.from(chunk));
  }
  return { ss, results };
}

describe('StreamSearch', () => {
  it('should correctly perform stream search', () => {
    const cases = [
      {
        needle: '\r\n',
        chunks: [
          'foo',
          ' bar',
          '\r',
          '\n',
          'baz, hello\r',
          '\n world.',
          '\r\n 1.2.3.4.5.6.7.8\r\n\r\n',
        ],
        expected: [
          [false, 'foo'],
          [false, ' bar'],
          [true, null],
          [false, 'baz, hello'],
          [true, null],
          [false, ' world.'],
          [true, null],
          [true, ' 1.2.3.4.5.6.7.8'],
          [true, ''],
        ],
      },
      {
        needle: '---foobarbaz',
        chunks: [
          '---foobarbaz',
          'asdf',
          '\r\n',
          '---foobarba',
          '---foobar',
          'ba',
          '\r\n---foobarbaz--\r\n',
        ],
        expected: [
          [true, null],
          [false, 'asdf'],
          [false, '\r\n'],
          [false, '---foobarba'],
          [false, '---foobarba'],
          [true, '\r\n'],
          [false, '--\r\n'],
        ],
      },
      {
        needle: 'foobar',
        chunks: ['fooba', 'r', 'fooba', 'r', 'foobar', 'foob', 'ar'],
        expected: [
          [true, null],
          [true, null],
          [true, null],
          [true, null],
        ],
      },
    ];

    for (const test of cases) {
      const { needle, chunks, expected } = test;
      const { results } = collect(needle, chunks);
      expect(results).to.deep.equal(expected);
    }
  });

  it('should accept a string needle', () => {
    const results = [];
    const ss = new StreamSearch('--', (isMatch, data, start, end) => {
      results.push([isMatch, data ? data.toString('latin1', start, end) : null]);
    });
    ss.push(Buffer.from('foo--bar'));
    expect(results).to.deep.equal([
      [true, 'foo'],
      [false, 'bar'],
    ]);
  });

  it('should throw when needle is not a Buffer or string', () => {
    expect(() => new StreamSearch(123, () => {})).to.throw();
  });

  it('should throw when callback is missing', () => {
    expect(() => new StreamSearch('needle')).to.throw();
  });

  it('should handle a single-byte needle', () => {
    const { results } = collect('x', ['axbxc', 'x']);
    expect(results).to.deep.equal([
      [true, 'a'],
      [true, 'b'],
      [false, 'c'],
      [true, null],
    ]);
  });

  it('should find no match when needle is absent', () => {
    const { results } = collect('xyz', ['hello', ' ', 'world']);
    expect(results.filter(([m]) => m)).to.be.empty;
  });

  it('should respect maxMatches', () => {
    const results = [];
    const ss = new StreamSearch(Buffer.from('a'), (isMatch, data, start, end) => {
      results.push([isMatch, data ? data.toString('latin1', start, end) : null]);
    });
    ss.maxMatches = 2;
    ss.push(Buffer.from('aaa'));
    expect(results.filter(([m]) => m)).to.have.length(2);
  });

  it('should reset state between uses', () => {
    const { ss, results } = collect('\r\n', ['foo\r\nbar']);
    expect(results).to.deep.equal([
      [true, 'foo'],
      [false, 'bar'],
    ]);

    ss.reset();
    const results2 = [];
    ss._cb = (isMatch, data, start, end) => {
      results2.push([isMatch, data ? data.toString('latin1', start, end) : null]);
    };
    ss.push(Buffer.from('baz\r\nqux'));
    expect(results2).to.deep.equal([
      [true, 'baz'],
      [false, 'qux'],
    ]);
  });

  it('should flush remaining lookbehind data on destroy', () => {
    const results = [];
    const ss = new StreamSearch(Buffer.from('--boundary'), (isMatch, data, start, end) => {
      results.push([isMatch, data ? data.toString('latin1', start, end) : null]);
    });
    // Push a partial needle that stays in lookbehind
    ss.push(Buffer.from('data--boun'));
    ss.destroy();
    // After destroy all buffered data must have been flushed as non-match
    const flushed = results
      .filter(([m]) => !m)
      .map(([, d]) => d)
      .join('');
    expect(flushed).to.include('data--boun');
  });

  it('should handle empty push gracefully', () => {
    const results = [];
    const ss = new StreamSearch(Buffer.from('abc'), (isMatch, data, start, end) => {
      results.push([isMatch, data ? data.toString('latin1', start, end) : null]);
    });
    ss.push(Buffer.from(''));
    ss.push(Buffer.from('abc'));
    expect(results.filter(([m]) => m)).to.have.length(1);
  });

  it('should handle needle split exactly across two chunks', () => {
    const { results } = collect('abcd', ['ab', 'cd']);
    expect(results.filter(([m]) => m)).to.have.length(1);
    expect(results.filter(([m]) => !m).map(([, d]) => d)).to.deep.equal([]);
  });

  it('should match at the very start of input', () => {
    const { results } = collect('abc', ['abcdef']);
    expect(results).to.deep.equal([
      [true, null],
      [false, 'def'],
    ]);
  });

  it('should match at the very end of input', () => {
    const { results } = collect('abc', ['defabc']);
    expect(results).to.deep.equal([[true, 'def']]);
  });

  it('should emit preceding bytes before a cross-chunk match', () => {
    const { results } = collect('abc', ['xxab', 'c']);
    expect(results).to.deep.equal([
      [false, 'xx'],
      [true, null],
    ]);
  });

  it('should emit cut off lookbehind bytes for no-match partial lookbehind', () => {
    const { results } = collect('abcde', ['zzabc', 'f']);
    expect(results).to.deep.equal([
      [false, 'zz'],
      [false, 'abc'],
      [false, 'f'],
    ]);
  });
});
