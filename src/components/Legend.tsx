import { LEGEND_COLORS } from '../render/theme';

interface LegendItem {
  key: keyof typeof LEGEND_COLORS;
  name: string;
  mark: string;
  note: string;
  /** 只在揭示阶段出现 */
  revealOnly?: boolean;
}

const ITEMS: LegendItem[] = [
  { key: 'player', name: '玩家', mark: '◆', note: '发光八面体 + 光环' },
  { key: 'start', name: '起点', mark: 'S', note: '出发位置' },
  { key: 'end', name: '终点', mark: 'E', note: '进入即胜利' },
  { key: 'explored', name: '安全格（已探索）', mark: '3', note: '中等方块，显示邻域雷数' },
  { key: 'unknown', name: '未探索格', mark: '·', note: '小方块 —— 靠尺寸区分，最不占视野' },
  { key: 'flag', name: '已插旗格', mark: '▲', note: '锥体：断言有雷，需先取消才能进入' },
  { key: 'unsure', name: '已标问号', mark: '?', note: '小方块：拿不准，不计数也不挡路' },
  { key: 'mine', name: '地雷', mark: '✸', note: '多面体，永久障碍，不可通行' },
  { key: 'rock', name: '实心岩块', mark: '■', note: '填满整格的不透明方块，永远挡路' },
  {
    key: 'flag-correct',
    name: '旗标对了',
    mark: '✓',
    note: '绿色锥体：这里确实有雷',
    revealOnly: true,
  },
  {
    key: 'flag-wrong',
    name: '旗标错了',
    mark: '✗',
    note: '红色锥体：这里其实没有雷',
    revealOnly: true,
  },
];

export interface LegendProps {
  /** 揭示阶段（失败或胜利后开启"显示全部地雷"）才显示旗帜判定图例 */
  revealing: boolean;
}

/** 图例：形状 + 尺寸 + 颜色 + 图标四重区分，不依赖单一颜色维度 */
export function Legend({ revealing }: LegendProps) {
  return (
    <div className="panel">
      <h3 className="panel__title">图例</h3>
      <ul className="legend">
        {ITEMS.filter((item) => revealing || !item.revealOnly).map((item) => (
          <li key={item.key} className="legend__item">
            <span
              className="legend__swatch"
              style={{ background: LEGEND_COLORS[item.key], borderColor: LEGEND_COLORS[item.key] }}
              aria-hidden="true"
            >
              {item.mark}
            </span>
            <span className="legend__text">
              <strong>{item.name}</strong>
              <em>{item.note}</em>
            </span>
          </li>
        ))}
      </ul>
      <p className="panel__note">
        格子状态主要靠<strong>形状和大小</strong>区分：未探索格最小、已探索格中等、
        岩块填满整格；旗帜是锥体、地雷是多面体。数字 0~26 表示该格周围 3×3×3 内的地雷总数，
        数字越大字体越重并带下划线标记。
      </p>
    </div>
  );
}
