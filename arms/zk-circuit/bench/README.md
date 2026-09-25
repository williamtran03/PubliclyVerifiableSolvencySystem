# Scaling benchmark

Every figure in `docs/comparison.md` is taken at N = 8 customers. These scripts measure
what that leaves out.

| Script | Question | Output |
| --- | --- | --- |
| `scale.ts` (`make zk-bench`) | What does it cost to prove, and where does it stop? | `results.json`, `results.md` |
| `verifier.ts` | What does on-chain verification cost, and does the verifier still deploy? | `verifier.json` |

`generate.ts` emits a Nargo project at any power-of-two capacity. Noir array sizes are
compile-time constants, so the benchmark generates a project per N instead of
parameterising the committed circuit. The generated statement is a copy of
`arms/zk-circuit/circuit/src/main.nr` — same leaf hash, same per-asset floor check, same
context binding — and at N = 8 it returns the same root `multiAssetTree.ts` computes,
which is what makes it usable as a stand-in.

## Two formulations

`mainNr` chains one `combine_level` call per tree level, as the committed circuit does.
Each call instantiates a fresh array type and Noir rejects the fifteenth:

```
error: Type is too complex (complexity: 100022, max: 100000)
   let level14 = combine_level(level13);
```

`mainNrFlat` writes every level into one flat array of `2N - 1` nodes with per-level
loops whose bounds are fixed at generation time. One array type, no ceiling, and it
compiles to an identical circuit — the gate counts match at every N. The chained form is
kept because the committed circuit is written that way, and the ceiling is a real
constraint on building this at depth.

## Running

```shell
make zk-bench                         # both forms, N = 8 … 32768
BENCH_N=8,512 make zk-bench           # a chosen sweep
BENCH_FORM=flat make zk-bench         # one form
BENCH_TIMEOUT=600 make zk-bench       # seconds per stage before a run is abandoned

BENCH_N=8,128,2048 npx tsx arms/zk-circuit/bench/verifier.ts
```

Results are rewritten after every N, so a sweep that dies at the largest size keeps the
curve it did measure. A failure is recorded as a row rather than thrown away.

Both scripts build into the system temp directory and touch nothing under `arms/` except
their own result files. Timings are wall-clock from `/usr/bin/time`, with peak RSS as the
child's high-water mark. Single runs, not averaged.
