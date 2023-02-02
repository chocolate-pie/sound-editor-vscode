const convert = (data: Float32Array) => {
  const _convert = (value: number) => {
    const newValue = value < 0 ? value * 0x8000 : value * 0x7fff;
    return Math.max(0 - 0x8000, Math.min(0x8000, newValue));
  };
  const newArray = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    newArray[i] = _convert(data[i++]);
  }
  return newArray;
};

export { convert };
