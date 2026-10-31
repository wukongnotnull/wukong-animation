export function fail(message) {
  throw new Error(message);
}

export function commandContext({ pos, opt }, log) {
  const aspectOpt = () => {
    if (opt('aspect') === true) fail('--aspect 后面要写画幅，如 --aspect 9:16（final 还可以写 all）');
    return typeof opt('aspect') === 'string' ? opt('aspect') : null;
  };
  return { pos, opt, log, aspectOpt };
}
