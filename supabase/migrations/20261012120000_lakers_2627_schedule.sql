-- LAKERS 26-27 HOME SCHEDULE (Eli, 2026-10-12). From the team's printable
-- schedule PDF (2627_lal_mktg_schedule_broadcast_printable_v7). Home games read
-- by cell colour (gold = home): 40 regular season incl. 2 NBA Cup group games,
-- plus 3 home preseason. Cup knockout games aren't scheduled yet — add with + Game.
-- Idempotent: skips any game already on the list.

insert into public.lakers_games (season, game_date, game_time, opponent, arena, note) values
  ('26-27', '2026-10-08', '7:30 PM', 'Sacramento Kings', 'Crypto.com Arena', 'Preseason'),
  ('26-27', '2026-10-13', '7:00 PM', 'Golden State Warriors', 'Crypto.com Arena', 'Preseason'),
  ('26-27', '2026-10-16', '7:30 PM', 'Denver Nuggets', 'Crypto.com Arena', 'Preseason'),
  ('26-27', '2026-10-21', '7:00 PM', 'Golden State Warriors', 'Crypto.com Arena', null),
  ('26-27', '2026-10-23', '7:00 PM', 'LA Clippers', 'Crypto.com Arena', null),
  ('26-27', '2026-10-27', '8:00 PM', 'Portland Trail Blazers', 'Crypto.com Arena', null),
  ('26-27', '2026-11-01', '6:00 PM', 'Toronto Raptors', 'Crypto.com Arena', null),
  ('26-27', '2026-11-02', '7:00 PM', 'Miami Heat', 'Crypto.com Arena', null),
  ('26-27', '2026-11-06', '7:00 PM', 'Portland Trail Blazers', 'Crypto.com Arena', 'NBA Cup'),
  ('26-27', '2026-11-17', '7:00 PM', 'Charlotte Hornets', 'Crypto.com Arena', null),
  ('26-27', '2026-11-18', '7:00 PM', 'Utah Jazz', 'Crypto.com Arena', null),
  ('26-27', '2026-11-20', '7:00 PM', 'Sacramento Kings', 'Crypto.com Arena', 'NBA Cup'),
  ('26-27', '2026-11-23', '7:00 PM', 'Utah Jazz', 'Crypto.com Arena', null),
  ('26-27', '2026-12-14', '7:00 PM', 'New Orleans Pelicans', 'Crypto.com Arena', null),
  ('26-27', '2026-12-21', '7:00 PM', 'Indiana Pacers', 'Crypto.com Arena', null),
  ('26-27', '2026-12-23', '7:00 PM', 'Denver Nuggets', 'Crypto.com Arena', null),
  ('26-27', '2026-12-25', '2:00 PM', 'Philadelphia 76ers', 'Crypto.com Arena', null),
  ('26-27', '2026-12-27', '6:00 PM', 'Memphis Grizzlies', 'Crypto.com Arena', null),
  ('26-27', '2026-12-29', '7:30 PM', 'Houston Rockets', 'Crypto.com Arena', null),
  ('26-27', '2027-01-07', '7:00 PM', 'Boston Celtics', 'Crypto.com Arena', null),
  ('26-27', '2027-01-08', '7:00 PM', 'Detroit Pistons', 'Crypto.com Arena', null),
  ('26-27', '2027-01-13', '7:00 PM', 'Orlando Magic', 'Crypto.com Arena', null),
  ('26-27', '2027-01-17', '6:00 PM', 'Milwaukee Bucks', 'Crypto.com Arena', null),
  ('26-27', '2027-01-22', '7:00 PM', 'Sacramento Kings', 'Crypto.com Arena', null),
  ('26-27', '2027-01-24', '1:00 PM', 'Washington Wizards', 'Crypto.com Arena', null),
  ('26-27', '2027-01-26', '8:00 PM', 'Oklahoma City Thunder', 'Crypto.com Arena', null),
  ('26-27', '2027-02-10', '7:00 PM', 'LA Clippers', 'Crypto.com Arena', null),
  ('26-27', '2027-02-12', '7:30 PM', 'Denver Nuggets', 'Crypto.com Arena', null),
  ('26-27', '2027-02-16', '7:00 PM', 'Chicago Bulls', 'Crypto.com Arena', null),
  ('26-27', '2027-02-18', '7:00 PM', 'Houston Rockets', 'Crypto.com Arena', null),
  ('26-27', '2027-03-06', '5:30 PM', 'Oklahoma City Thunder', 'Crypto.com Arena', null),
  ('26-27', '2027-03-07', '7:30 PM', 'Brooklyn Nets', 'Crypto.com Arena', null),
  ('26-27', '2027-03-11', '7:00 PM', 'New York Knicks', 'Crypto.com Arena', null),
  ('26-27', '2027-03-12', '7:00 PM', 'Cleveland Cavaliers', 'Crypto.com Arena', null),
  ('26-27', '2027-03-14', '7:00 PM', 'Golden State Warriors', 'Crypto.com Arena', null),
  ('26-27', '2027-03-17', '7:00 PM', 'Phoenix Suns', 'Crypto.com Arena', null),
  ('26-27', '2027-03-19', '7:00 PM', 'Atlanta Hawks', 'Crypto.com Arena', null),
  ('26-27', '2027-03-21', '7:00 PM', 'Dallas Mavericks', 'Crypto.com Arena', null),
  ('26-27', '2027-04-04', '7:00 PM', 'San Antonio Spurs', 'Crypto.com Arena', null),
  ('26-27', '2027-04-06', '7:00 PM', 'Dallas Mavericks', 'Crypto.com Arena', null),
  ('26-27', '2027-04-07', '7:00 PM', 'Minnesota Timberwolves', 'Crypto.com Arena', null),
  ('26-27', '2027-04-09', '7:00 PM', 'Minnesota Timberwolves', 'Crypto.com Arena', null),
  ('26-27', '2027-04-11', '5:30 PM', 'Phoenix Suns', 'Crypto.com Arena', null)
on conflict (season, game_date, opponent) do nothing;

select count(*) filter (where note is distinct from 'Preseason') as home_games,
       count(*) filter (where note = 'Preseason') as preseason
from public.lakers_games where season = '26-27';
