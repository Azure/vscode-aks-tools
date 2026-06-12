export interface FuzzyMatch {
    matched: boolean;
    score: number;
}

// Subsequence matcher with relevance scoring, used to rank dropdown items as the user types.
// A contiguous substring always outranks a scattered subsequence; among subsequences, characters
// that are adjacent or sit at a word boundary (start, or after a separator) score higher so that
// e.g. "eus" ranks "eastus2" above an incidental scatter match.
export function fuzzyMatch(query: string, target: string): FuzzyMatch {
    if (query === "") {
        return { matched: true, score: 0 };
    }

    const q = query.toLowerCase();
    const t = target.toLowerCase();

    const substringIndex = t.indexOf(q);
    if (substringIndex !== -1) {
        return { matched: true, score: 1000 - substringIndex };
    }

    let score = 0;
    let queryIndex = 0;
    let prevMatchIndex = -1;
    for (let i = 0; i < t.length && queryIndex < q.length; i++) {
        if (t[i] === q[queryIndex]) {
            if (prevMatchIndex === i - 1) {
                score += 5;
            }
            if (i === 0 || /[\s\-_./]/.test(t[i - 1])) {
                score += 3;
            }
            prevMatchIndex = i;
            queryIndex++;
        }
    }

    return queryIndex === q.length ? { matched: true, score } : { matched: false, score: 0 };
}
