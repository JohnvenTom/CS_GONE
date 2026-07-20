/**
 * Scoreboard.js - 计分板（按 Tab 展开）
 * --------------------------------------------------------------
 * 显示 CT / T 两列玩家信息：
 *  排名 / 名称 / 击杀 / 助攻 / 死亡 / 金钱 / 存活状态
 * --------------------------------------------------------------
 */

export class Scoreboard {
  constructor() {
    this.el = document.getElementById('scoreboard');
    this.ctCol = document.getElementById('sb-ct-column');
    this.tCol = document.getElementById('sb-t-column');
    this.ctScoreEl = document.getElementById('sb-ct-score');
    this.tScoreEl = document.getElementById('sb-t-score');
  }

  /**
   * 显示/隐藏计分板
   * @param {boolean} show
   */
  show(show) {
    this.el.classList.toggle('active', show);
  }

  /**
   * 切换显示
   */
  toggle() {
    this.el.classList.toggle('active');
  }

  /**
   * 渲染计分板内容
   * @param {Object} data
   * @param {Array} data.ct CT 玩家列表
   * @param {Array} data.t T 玩家列表
   * @param {number} data.ctScore
   * @param {number} data.tScore
   * @param {string} localPlayerName 本地玩家名（用于高亮）
   */
  render({ ct, t, ctScore, tScore, localPlayerName }) {
    this.ctScoreEl.textContent = ctScore;
    this.tScoreEl.textContent = tScore;

    this._renderColumn(this.ctCol, ct, localPlayerName);
    this._renderColumn(this.tCol, t, localPlayerName);
  }

  /**
   * 渲染单列
   * @private
   */
  _renderColumn(col, players, localName) {
    if (!col) return;
    col.innerHTML = '';
    if (players.length === 0) {
      col.innerHTML = '<div style="text-align:center;opacity:0.4;padding:16px;">无玩家</div>';
      return;
    }
    // 按击杀排序
    players.sort((a, b) => b.kills - a.kills);
    players.forEach((p, idx) => {
      const row = document.createElement('div');
      row.className = 'sb-row';
      if (p.name === localName) row.classList.add('local');
      if (!p.isAlive) row.classList.add('dead');
      const rank = idx === 0 && p.kills > 0 ? '★' : (idx + 1);
      row.innerHTML = `
        <span class="sb-rank">${rank}</span>
        <span class="sb-name"><span class="sb-alive-dot${p.isAlive ? '' : ' dead'}"></span>${p.name}</span>
        <span class="sb-stat">${p.kills}</span>
        <span class="sb-stat">${p.assists || 0}</span>
        <span class="sb-stat">${p.deaths}</span>
        <span class="sb-money">$${p.money || 0}</span>
      `;
      col.appendChild(row);
    });
  }
}
