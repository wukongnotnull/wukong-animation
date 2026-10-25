/* __NAME__ 工具包 —— 挂在 wk.__GLOBAL__ 下。
 * 规则：
 *   1. 只用传入的 seed 产生随机性，禁止 Math.random
 *   2. 函数必须是纯函数或只读缓存（镜头会乱序渲染静帧）
 *   3. 每个导出函数写 JSDoc —— README.md 由 tools/build-docs.mjs 从这里生成，模型靠它学会调用
 */
(function () {
  'use strict';
  const kit = (wk.__GLOBAL__ = {});

  /**
   * 示例函数。
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} o
   */
  kit.example = function (ctx, o) {};
})();
