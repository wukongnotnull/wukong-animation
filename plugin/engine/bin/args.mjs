// 命令行参数：wka <命令> <位置参数…> [--选项 值 | --选项=值 | --开关]
const VALUE_OPTS = /^--(style|dir|aspect|frames|at|only|formats|step|voices|text|rate|pitch)$/; // 后面跟值的选项

/** @returns {{cmd: string, pos: string[], opt: (name: string, def?: any) => any}} */
export function parseArgs(argv) {
  const pos = argv.slice(1).filter((a, i, arr) => !a.startsWith('--') && !VALUE_OPTS.test(arr[i - 1] || ''));
  const opt = (name, def = null) => {
    const i = argv.indexOf(`--${name}`);
    if (i !== -1) {
      const v = argv[i + 1];
      return v === undefined || v.startsWith('--') ? true : v;
    }
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    if (eq === undefined) return def;
    return eq.slice(name.length + 3) || true; // --name= 空值当作没给值
  };
  return { cmd: argv[0], pos, opt };
}
