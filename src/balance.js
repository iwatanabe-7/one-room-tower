// バランス値。Unity 版 GameBalance / GDD と同じ名前・値にそろえる（数値はここだけに書く）
export const BAL = {
  // 移動（GameBalance と同じ）
  MoveSpeed: 5,
  SprintMultiplier: 1.6,
  TurnSpeed: 720,
  JumpHeight: 1.2,
  Gravity: -20,
  Acceleration: 60,
  CoyoteTime: 0.1,
  JumpBufferTime: 0.1,
  MaxFallSpeed: 30,
  HitStopSeconds: 0.05,
  // キャラの見た目の動き（手触り用。当たり判定には影響しない）
  HeroStepFrequency: 2.2,     // 歩幅1歩あたりの周波数の係数（速さ m/s に掛ける）
  HeroBobHeight: 0.06,        // 歩くときの上下の弾み（m）
  HeroLimbSwing: 0.55,        // 手足の振り（rad）
  HeroIdleTurnSeconds: 1.2,   // 止まってからカメラの方へ振り向くまで（秒）
  HeroBlinkInterval: 2.8,     // まばたきの間隔（秒）
  HeroJumpStretch: 0.18,      // ジャンプした瞬間の縦伸び
  HeroAntennaSpring: 40,      // 触覚のばねの硬さ
  HeroAntennaDamping: 6,      // 触覚の揺れの減衰
  // 部屋の規格
  RoomSize: 24,
  ExitFloorDepth: 3,
  ExitFloorWidth: 6,
  ExitGateInset: 0.2,
  ExitDoorInset: 2.4,
  ExitTriggerInset: 1.4,
  ExitTriggerYSlack: 0.1,
  CameraOffsetY: 8,
  CameraOffsetZ: -11,
  RoomRiseHeight: 3,
  MaxRoomsAlive: 2,
  RoomAppearSeconds: 0.25,
  RoomAppearDepth: 6,
  RoomParTime: 30,
  RoomSeed: 0,
  // フロア進行
  TowerFloorCount: 20,
  RestFloorInterval: 5,
  DifficultyBudgetBase: 2,
  DifficultyBudgetPerFloor: 0.25,
  MaxGimmickTypesPerRoom: 3,
  MaxGimmicksPerRoom: 4,
  MaxBarsPerRoom: 2,
  GimmickCostBar: 1.5,
  GimmickCostCrumble: 1,
  GimmickCostKey: 1,
  GimmickCostLift: 1.5,
  // プレイヤーの体力
  PlayerMaxHp: 3,
  InvincibleSeconds: 1.0,
  KnockbackSpeed: 8,
  KnockbackUpSpeed: 5,
  StunSeconds: 0.25,
  FallRespawnDepth: 6,
  // 強化
  UpgradeChoiceCount: 3,
  // 仕掛け: 回転バー
  BarTipSpeedBase: 3.0,
  BarTipSpeedPerFloor: 0.15,
  BarTipSpeedMax: 5.0,
  BarAngularSpeedMax: 2.2,
  BarHitRadius: 0.36,
  BarArmHeight: 0.35,
  BarHitHalfHeight: 0.08,
  BarKnockbackSpeed: 5,
  BarClearance: 0.3,
  BarWarnRingOpacity: 0.25,
  // 仕掛け: 動く足場
  LiftEndPauseSeconds: 0.5,
  LiftRailWidth: 0.12,
  LiftRailHeight: 0.04,
  // 仕掛け: 崩れる床
  CrumbleShakeSeconds: 0.55,
  CrumbleRespawnSeconds: 3,
  // 仕掛け: 鍵と扉
  KeyPickupRadius: 1.1,
};

// 難易度予算で使う仕掛けの重さ
export const GIMMICK_COST = { bar: BAL.GimmickCostBar, crumble: BAL.GimmickCostCrumble, key: BAL.GimmickCostKey, lift: BAL.GimmickCostLift };
export const GIMMICK_NAME = { bar: '回転バー', crumble: '崩れる床', key: '鍵と扉', lift: '動く足場' };
