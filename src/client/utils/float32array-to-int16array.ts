const convert = (data: Float32Array) => {
    const newArray = new Int16Array(data.length);
    for (let i = 0; i < data.length; i++) {
        newArray[i] = ((n) => {
            const newValue = n < 0 ? n * 0x8000 : n * 0x7FFF;
            return Math.max(0 - 0x8000, Math.min(0x8000, newValue));
        })(data[i++]);
    }
    return newArray;
};

export { convert };