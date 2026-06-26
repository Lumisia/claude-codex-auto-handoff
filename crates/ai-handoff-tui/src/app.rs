//! The ratatui application: state, key handling, and drawing for the
//! Overview / Usage / Settings tabs.
//!
//! `on_key` is kept independent of the terminal (it only mutates state and, on
//! a Settings save, writes config) so the interaction logic is unit-testable
//! without a TTY. The draw + event loop are the thin, untested shell.

use std::path::PathBuf;
use std::time::Duration;

use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind};
use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style, Stylize},
    text::{Line, Span},
    widgets::{Block, Borders, Cell, Paragraph, Row, Table, Tabs},
    DefaultTerminal, Frame,
};

use ai_handoff_core::dashboard::{CheckStatus, DashboardSnapshot};
use ai_handoff_usage::{aggregate::Group, Dimension};

use crate::edit::{self, EditAction};
use crate::viewmodel::{health_rows, settings_rows, HealthRow, SettingRow, UsageView};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tab {
    Overview,
    Usage,
    Settings,
}

impl Tab {
    const ALL: [Tab; 3] = [Tab::Overview, Tab::Usage, Tab::Settings];
    fn title(self) -> &'static str {
        match self {
            Tab::Overview => "Overview",
            Tab::Usage => "Usage",
            Tab::Settings => "Settings",
        }
    }
    fn index(self) -> usize {
        Tab::ALL.iter().position(|t| *t == self).unwrap_or(0)
    }
    fn next(self) -> Tab {
        Tab::ALL[(self.index() + 1) % Tab::ALL.len()]
    }
    fn prev(self) -> Tab {
        Tab::ALL[(self.index() + Tab::ALL.len() - 1) % Tab::ALL.len()]
    }
}

const DIMS: [Dimension; 4] = [
    Dimension::Day,
    Dimension::Model,
    Dimension::Project,
    Dimension::Source,
];

fn dim_name(dim: Dimension) -> &'static str {
    match dim {
        Dimension::Day => "day",
        Dimension::Model => "model",
        Dimension::Project => "project",
        Dimension::Source => "source",
    }
}

pub struct App {
    pub tab: Tab,
    snapshot: DashboardSnapshot,
    usage: UsageView,
    usage_dim: Dimension,
    settings: Vec<SettingRow>,
    settings_idx: usize,
    config_path: PathBuf,
    status: String,
    should_quit: bool,
}

impl App {
    /// Build the app by scanning the live system (logs, config, health).
    pub fn load() -> Self {
        let snapshot = ai_handoff_core::dashboard::dashboard_snapshot();
        let usage = UsageView::from_events(&ai_handoff_usage::scan_default());
        let cfg = ai_handoff_core::config::load();
        let config_path = ai_handoff_core::paths::config_path();
        App::new(snapshot, usage, settings_rows(&cfg), config_path)
    }

    pub fn new(
        snapshot: DashboardSnapshot,
        usage: UsageView,
        settings: Vec<SettingRow>,
        config_path: PathBuf,
    ) -> Self {
        App {
            tab: Tab::Overview,
            snapshot,
            usage,
            usage_dim: Dimension::Day,
            settings,
            settings_idx: 0,
            config_path,
            status: "q quit · Tab switch · g cycle breakdown · ←/→/space edit settings".to_string(),
            should_quit: false,
        }
    }

    pub fn should_quit(&self) -> bool {
        self.should_quit
    }

    /// The event loop. Returns when the user quits.
    pub fn run(&mut self, terminal: &mut DefaultTerminal) -> std::io::Result<()> {
        while !self.should_quit {
            terminal.draw(|f| self.draw(f))?;
            if event::poll(Duration::from_millis(250))? {
                if let Event::Key(key) = event::read()? {
                    if key.kind == KeyEventKind::Press {
                        self.on_key(key);
                    }
                }
            }
        }
        Ok(())
    }

    /// Handle one keypress. Pure except for a config file write on Settings edit.
    pub fn on_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Char('q') | KeyCode::Esc => self.should_quit = true,
            KeyCode::Tab | KeyCode::Right if self.tab != Tab::Settings => {
                self.tab = self.tab.next();
            }
            KeyCode::BackTab | KeyCode::Left if self.tab != Tab::Settings => {
                self.tab = self.tab.prev();
            }
            KeyCode::Char('1') => self.tab = Tab::Overview,
            KeyCode::Char('2') => self.tab = Tab::Usage,
            KeyCode::Char('3') => self.tab = Tab::Settings,
            _ => match self.tab {
                Tab::Usage => self.on_usage_key(key),
                Tab::Settings => self.on_settings_key(key),
                Tab::Overview => {}
            },
        }
    }

    fn on_usage_key(&mut self, key: KeyEvent) {
        if let KeyCode::Char('g') = key.code {
            let idx = DIMS.iter().position(|d| *d == self.usage_dim).unwrap_or(0);
            self.usage_dim = DIMS[(idx + 1) % DIMS.len()];
        }
    }

    fn on_settings_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Up | KeyCode::Char('k') => {
                if self.settings_idx > 0 {
                    self.settings_idx -= 1;
                }
            }
            KeyCode::Down | KeyCode::Char('j') => {
                if self.settings_idx + 1 < self.settings.len() {
                    self.settings_idx += 1;
                }
            }
            KeyCode::Char(' ') => self.edit_current(EditAction::Toggle),
            KeyCode::Right | KeyCode::Char('+') | KeyCode::Char('=') => {
                self.edit_current(EditAction::Next)
            }
            KeyCode::Left | KeyCode::Char('-') => self.edit_current(EditAction::Prev),
            _ => {}
        }
    }

    /// Apply an edit to the selected setting and persist it.
    fn edit_current(&mut self, action: EditAction) {
        let Some(row) = self.settings.get(self.settings_idx).cloned() else {
            return;
        };
        let Some(raw) = edit::next_raw(row.kind, &row.value, action) else {
            self.status = format!("{}: cannot edit current value", row.key);
            return;
        };
        match edit::commit(&self.config_path, row.key, &raw) {
            Ok(_) => {
                self.settings[self.settings_idx].value = raw.clone();
                self.status = format!("saved {} = {}", row.key, raw);
            }
            Err(e) => self.status = format!("{}: {e}", row.key),
        }
    }

    // --- drawing -------------------------------------------------------

    fn draw(&self, f: &mut Frame) {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(3),
                Constraint::Min(3),
                Constraint::Length(3),
            ])
            .split(f.area());

        self.draw_tabs(f, chunks[0]);
        match self.tab {
            Tab::Overview => self.draw_overview(f, chunks[1]),
            Tab::Usage => self.draw_usage(f, chunks[1]),
            Tab::Settings => self.draw_settings(f, chunks[1]),
        }
        self.draw_status(f, chunks[2]);
    }

    fn draw_tabs(&self, f: &mut Frame, area: Rect) {
        let titles = Tab::ALL.iter().map(|t| Line::from(t.title()));
        let tabs = Tabs::new(titles)
            .select(self.tab.index())
            .block(Block::default().borders(Borders::ALL).title("AI Handoff"))
            .highlight_style(Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD));
        f.render_widget(tabs, area);
    }

    fn draw_overview(&self, f: &mut Frame, area: Rect) {
        let cols = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(55), Constraint::Percentage(45)])
            .split(area);

        let rows = health_rows(&self.snapshot).into_iter().map(health_table_row);
        let table = Table::new(rows, [Constraint::Length(18), Constraint::Length(8), Constraint::Min(10)])
            .header(Row::new(["Check", "Status", "Detail"]).style(Style::default().add_modifier(Modifier::BOLD)))
            .block(Block::default().borders(Borders::ALL).title("Health"));
        f.render_widget(table, cols[0]);

        let total = &self.usage.total;
        let mut lines = vec![
            Line::from(format!("Total tokens: {}", thousands(total.tokens.total()))),
            Line::from(format!("Est cost:     ~${:.2}", total.cost_usd)),
            Line::from(""),
        ];
        for g in &self.usage.by_source {
            lines.push(Line::from(format!(
                "{:<7} {:>14} tok  ~${:.2}",
                g.key,
                thousands(g.tokens.total()),
                g.cost_usd
            )));
        }
        lines.push(Line::from(""));
        lines.push(Line::from("estimate — not an official bill").italic());
        let para = Paragraph::new(lines)
            .block(Block::default().borders(Borders::ALL).title("Token usage"));
        f.render_widget(para, cols[1]);
    }

    fn draw_usage(&self, f: &mut Frame, area: Rect) {
        let dim = self.usage_dim;
        let groups = self.usage.breakdown(dim);
        let title = format!(
            "By {} — total {} tok ~${:.2} (g: change)",
            dim_name(dim),
            thousands(self.usage.total.tokens.total()),
            self.usage.total.cost_usd
        );
        if groups.is_empty() {
            let para = Paragraph::new("No usage logs found under ~/.claude/projects or ~/.codex.")
                .block(Block::default().borders(Borders::ALL).title(title));
            f.render_widget(para, area);
            return;
        }
        let rows = groups.iter().map(group_table_row);
        let table = Table::new(
            rows,
            [Constraint::Min(16), Constraint::Length(16), Constraint::Length(12), Constraint::Length(14)],
        )
        .header(Row::new(["Key", "Tokens", "Est $", "Unpriced"]).style(Style::default().add_modifier(Modifier::BOLD)))
        .block(Block::default().borders(Borders::ALL).title(title));
        f.render_widget(table, area);
    }

    fn draw_settings(&self, f: &mut Frame, area: Rect) {
        let rows = self.settings.iter().enumerate().map(|(i, r)| {
            let style = if i == self.settings_idx {
                Style::default().fg(Color::Black).bg(Color::Cyan)
            } else {
                Style::default()
            };
            Row::new([Cell::from(r.key), Cell::from(r.value.clone())]).style(style)
        });
        let table = Table::new(rows, [Constraint::Min(36), Constraint::Length(14)])
            .header(Row::new(["Setting", "Value"]).style(Style::default().add_modifier(Modifier::BOLD)))
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title("Settings (↑/↓ select · space toggle · ←/→ change · applies to both agents)"),
            );
        f.render_widget(table, area);
    }

    fn draw_status(&self, f: &mut Frame, area: Rect) {
        let para = Paragraph::new(Span::raw(&self.status))
            .block(Block::default().borders(Borders::ALL));
        f.render_widget(para, area);
    }
}

fn health_table_row(r: HealthRow) -> Row<'static> {
    let (sym, color) = status_style(&r.status);
    Row::new([
        Cell::from(r.label),
        Cell::from(sym).style(Style::default().fg(color)),
        Cell::from(r.detail),
    ])
}

fn group_table_row(g: &Group) -> Row<'static> {
    let unpriced = if g.unpriced_tokens > 0 {
        thousands(g.unpriced_tokens)
    } else {
        "-".to_string()
    };
    let key = if g.key.is_empty() { "(unknown)".to_string() } else { g.key.clone() };
    Row::new([
        Cell::from(key),
        Cell::from(thousands(g.tokens.total())),
        Cell::from(format!("{:.2}", g.cost_usd)),
        Cell::from(unpriced),
    ])
}

fn status_style(status: &CheckStatus) -> (&'static str, Color) {
    match status {
        CheckStatus::Ok => ("ok", Color::Green),
        CheckStatus::Warning => ("warn", Color::Yellow),
        CheckStatus::Error => ("error", Color::Red),
        CheckStatus::Missing => ("missing", Color::DarkGray),
        CheckStatus::Unknown => ("?", Color::DarkGray),
    }
}

/// Group digits in threes with commas.
fn thousands(n: u64) -> String {
    let digits = n.to_string();
    let bytes = digits.as_bytes();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, b) in bytes.iter().enumerate() {
        if i > 0 && (bytes.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(*b as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::KeyModifiers;

    fn key(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::NONE)
    }

    fn test_app() -> App {
        let dir = tempfile::tempdir().unwrap();
        let snapshot = ai_handoff_core::dashboard::dashboard_snapshot_for(dir.path(), dir.path());
        let usage = UsageView::from_events(&[]);
        let cfg = ai_handoff_core::config::Config::default();
        let path = dir.path().join("config.toml");
        // leak the tempdir so the path stays valid for the test body
        std::mem::forget(dir);
        App::new(snapshot, usage, settings_rows(&cfg), path)
    }

    #[test]
    fn q_quits() {
        let mut app = test_app();
        app.on_key(key(KeyCode::Char('q')));
        assert!(app.should_quit());
    }

    #[test]
    fn tab_cycles_forward_and_number_keys_jump() {
        let mut app = test_app();
        assert_eq!(app.tab, Tab::Overview);
        app.on_key(key(KeyCode::Tab));
        assert_eq!(app.tab, Tab::Usage);
        app.on_key(key(KeyCode::Char('3')));
        assert_eq!(app.tab, Tab::Settings);
        app.on_key(key(KeyCode::Char('1')));
        assert_eq!(app.tab, Tab::Overview);
    }

    #[test]
    fn g_cycles_usage_dimension() {
        let mut app = test_app();
        app.tab = Tab::Usage;
        assert_eq!(app.usage_dim, Dimension::Day);
        app.on_key(key(KeyCode::Char('g')));
        assert_eq!(app.usage_dim, Dimension::Model);
    }

    #[test]
    fn settings_navigation_and_edit_persist() {
        let mut app = test_app();
        app.tab = Tab::Settings;
        // first row is triggers.five_hour.enabled (bool, default true)
        let first_key = app.settings[0].key;
        app.on_key(key(KeyCode::Char(' ')));
        assert_eq!(app.settings[0].value, "false");
        assert!(app.status.contains("saved"));
        // the write actually landed
        let cfg = ai_handoff_core::config::load_from(&app.config_path);
        let val = ai_handoff_core::config::get_value(&cfg, first_key).unwrap();
        assert_eq!(val, "false");
    }

    #[test]
    fn settings_down_moves_selection() {
        let mut app = test_app();
        app.tab = Tab::Settings;
        app.on_key(key(KeyCode::Down));
        assert_eq!(app.settings_idx, 1);
        app.on_key(key(KeyCode::Up));
        assert_eq!(app.settings_idx, 0);
    }

    #[test]
    fn left_right_do_not_switch_tabs_in_settings() {
        let mut app = test_app();
        app.tab = Tab::Settings;
        app.settings_idx = 1; // mode row? regardless, Left edits, not tab-switch
        app.on_key(key(KeyCode::Left));
        assert_eq!(app.tab, Tab::Settings, "Left must edit, not leave Settings");
    }
}
