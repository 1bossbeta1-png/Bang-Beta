export interface Question {
  id: number;
  clue: string;
  answer: string;
  point_reward: number;
  fact_short: string;
}

export interface LevelData {
  level: 'Easy' | 'Medium' | 'Hard';
  grid_config: string;
  questions: Question[];
}

export interface GameData {
  app_name_reference: string;
  game_data: LevelData[];
}

export interface UserProfile {
  uid: string;
  displayName: string;
  totalPoints: number;
  completedQuestions: number[];
}
