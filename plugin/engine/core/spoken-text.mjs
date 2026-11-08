const NOT_COUNTED = /[\s，。！？、；：,.!?;:…“”‘’"'（）()《》〈〉「」『』【】—\-·~～]/gu;
export const countChars = (text) => [...String(text || '').replace(NOT_COUNTED, '')].length;
