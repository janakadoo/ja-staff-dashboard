import { useState, useEffect, useMemo } from 'react';
import { supabase } from './supabase';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, ComposedChart
} from 'recharts';
import './index.css';

const exportToCSV = (filename, rows) => {
  if (!rows || !rows.length) return;
  const separator = ',';
  const keys = Object.keys(rows[0]);
  const csvContent =
    keys.join(separator) +
    '\n' +
    rows.map(row => {
      return keys.map(k => {
        let cell = row[k] === null || row[k] === undefined ? '' : row[k];
        cell = cell instanceof Date ? cell.toLocaleString() : cell.toString().replace(/"/g, '""');
        if (cell.search(/("|,|\n)/g) >= 0) cell = `"${cell}"`;
        return cell;
      }).join(separator);
    }).join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
const addressCache = {};

function App() {
  const [activeTab, setActiveTab] = useState('analytics');
  const [analyticsMode, setAnalyticsMode] = useState('monthly');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [filterStaff, setFilterStaff] = useState('ALL');
  const [filterFromDate, setFilterFromDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterToDate, setFilterToDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);
  const [staffList, setStaffList] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [visits, setVisits] = useState([]);

  useEffect(() => {
    fetchData();

    // Setup Realtime subscriptions
    const staffSub = supabase.channel('public:staff')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff' }, fetchData)
      .subscribe();
      
    const attSub = supabase.channel('public:attendance')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, fetchData)
      .subscribe();
      
    const visitsSub = supabase.channel('public:visits')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visits' }, fetchData)
      .subscribe();

    return () => {
      supabase.removeChannel(staffSub);
      supabase.removeChannel(attSub);
      supabase.removeChannel(visitsSub);
    };
  }, []);

  const fetchData = async () => {
    try {
      const [staffRes, attRes, visitsRes] = await Promise.all([
        supabase.from('staff').select('*'),
        supabase.from('attendance').select('*').order('timestamp', { ascending: false }),
        supabase.from('visits').select('*').order('time_in', { ascending: false })
      ]);

      if (staffRes.data) setStaffList(staffRes.data);
      if (attRes.data) setAttendance(attRes.data);
      if (visitsRes.data) setVisits(visitsRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStaffName = (id) => {
    const staff = staffList.find(s => s.id === id);
    return staff ? staff.name : 'Unknown Staff';
  };

  // Compute Summary Statistics
  const todayStart = new Date();
  todayStart.setHours(0,0,0,0);
  
  const presentStaffIds = new Set(
    attendance
      .filter(a => new Date(a.timestamp) >= todayStart && a.type === 'WORK_IN')
      .map(a => a.staff_id)
  );
  
  const presentToday = presentStaffIds.size;
  const presentStaffNames = staffList.filter(s => presentStaffIds.has(s.id));
  const absentStaffNames = staffList.filter(s => !presentStaffIds.has(s.id));

  const activeVisits = visits.filter(v => !v.time_out).length;

  const formatDate = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
    });
  };

  const formatDuration = (timeIn, timeOut) => {
    if (!timeIn) return '-';
    const t1 = new Date(timeIn).getTime();
    const t2 = timeOut ? new Date(timeOut).getTime() : new Date().getTime();
    const diffMins = Math.floor((t2 - t1) / (1000 * 60));
    if (diffMins < 0) return '-';
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    if (hours === 0) return `${mins} mins`;
    return `${hours} hrs ${mins} mins`;
  };

  const filteredTableAttendance = attendance.filter(log => {
    const matchStaff = filterStaff === 'ALL' || log.staff_id === filterStaff;
    if (!log.timestamp) return false;
    const logDate = new Date(log.timestamp).toISOString().split('T')[0];
    const matchDate = logDate >= filterFromDate && logDate <= filterToDate;
    return matchStaff && matchDate;
  });

  const filteredTableVisits = visits.filter(v => {
    const matchStaff = filterStaff === 'ALL' || v.staff_id === filterStaff;
    if (!v.time_in) return false;
    const logDate = new Date(v.time_in).toISOString().split('T')[0];
    const matchDate = logDate >= filterFromDate && logDate <= filterToDate;
    return matchStaff && matchDate;
  });

  const handleExport = () => {
    if (activeTab === 'attendance') {
      const data = filteredTableAttendance.map(log => ({
        'Date & Time': formatDate(log.timestamp),
        'Staff Member': getStaffName(log.staff_id),
        'Type': log.type,
        'Reason': log.reason || '',
        'Location Map': log.lat ? `https://www.google.com/maps/search/?api=1&query=${log.lat},${log.lng}` : ''
      }));
      exportToCSV('JA_Staff_Attendance_Report.csv', data);
    } else if (activeTab === 'visits') {
      const data = filteredTableVisits.map(v => ({
        'Staff Member': getStaffName(v.staff_id),
        'Shop Name': v.shop_name,
        'Time IN': formatDate(v.time_in),
        'Time OUT': v.time_out ? formatDate(v.time_out) : 'Ongoing',
        'Duration': formatDuration(v.time_in, v.time_out),
        'Map IN': v.lat_in ? `https://www.google.com/maps/search/?api=1&query=${v.lat_in},${v.lng_in}` : '',
        'Map OUT': v.lat_out ? `https://www.google.com/maps/search/?api=1&query=${v.lat_out},${v.lng_out}` : ''
      }));
      exportToCSV('JA_Staff_Visits_Report.csv', data);
    } else {
      exportToCSV('JA_Staff_Analytics_Summary.csv', staffStats);
    }
  };

  // Analytics Calculations
  const filteredVisits = useMemo(() => {
    if (analyticsMode === 'monthly') {
      return visits.filter(v => v.time_in && new Date(v.time_in).toISOString().startsWith(selectedMonth));
    }
    return visits.filter(v => v.time_in && new Date(v.time_in).toISOString().split('T')[0] === selectedDate);
  }, [visits, analyticsMode, selectedDate, selectedMonth]);

  const filteredAttendance = useMemo(() => {
    if (analyticsMode === 'monthly') {
      return attendance.filter(a => a.timestamp && new Date(a.timestamp).toISOString().startsWith(selectedMonth));
    }
    return attendance.filter(a => a.timestamp && new Date(a.timestamp).toISOString().split('T')[0] === selectedDate);
  }, [attendance, analyticsMode, selectedDate, selectedMonth]);

  const staffStats = useMemo(() => {
    const stats = {};
    staffList.forEach(s => {
      stats[s.id] = { name: s.name, workHours: 0, visitHours: 0, visitCount: 0 };
    });

    filteredVisits.forEach(v => {
      if (stats[v.staff_id]) {
        stats[v.staff_id].visitCount += 1;
        if (v.time_in && v.time_out) {
          const t1 = new Date(v.time_in).getTime();
          const t2 = new Date(v.time_out).getTime();
          stats[v.staff_id].visitHours += (t2 - t1) / (1000 * 60 * 60);
        }
      }
    });

    const attByStaffDate = {};
    filteredAttendance.forEach(a => {
      const dateKey = new Date(a.timestamp).toLocaleDateString();
      const key = `${a.staff_id}_${dateKey}`;
      if (!attByStaffDate[key]) attByStaffDate[key] = { staffId: a.staff_id, in: null, out: null };
      
      const d = new Date(a.timestamp);
      if (a.type === 'WORK_IN') {
        if (!attByStaffDate[key].in || d < attByStaffDate[key].in) attByStaffDate[key].in = d;
      } else if (a.type === 'WORK_OUT') {
        if (!attByStaffDate[key].out || d > attByStaffDate[key].out) attByStaffDate[key].out = d;
      }
    });

    Object.values(attByStaffDate).forEach(day => {
      if (day.in && day.out && stats[day.staffId]) {
        const diff = (day.out.getTime() - day.in.getTime()) / (1000 * 60 * 60);
        stats[day.staffId].workHours += diff;
      }
    });

    return Object.values(stats).map(s => ({
      'Staff Name': s.name,
      'Total Work Hours': parseFloat(s.workHours.toFixed(1)),
      'Total Visit Hours': parseFloat(s.visitHours.toFixed(1)),
      'Visited Shops': s.visitCount
    })).sort((a, b) => b['Total Work Hours'] - a['Total Work Hours']);
  }, [staffList, filteredAttendance, filteredVisits]);

  const activityData = useMemo(() => {
    const counts = { 'WORK_IN': 0, 'LEAVE': 0 };
    filteredAttendance.forEach(a => {
      if (a.type === 'WORK_IN' || a.type === 'LEAVE') counts[a.type]++;
    });
    return [
      { name: 'Worked Days', value: counts['WORK_IN'] },
      { name: 'Leaves', value: counts['LEAVE'] }
    ];
  }, [filteredAttendance]);

  const LiveDuration = ({ timeIn, timeOut }) => {
    const [, setTick] = useState(0);

    useEffect(() => {
      if (timeOut) return;
      const interval = setInterval(() => setTick(t => t + 1), 60000);
      return () => clearInterval(interval);
    }, [timeOut]);

    const formatted = formatDuration(timeIn, timeOut);
    if (!timeOut) {
      return <span className="live-timer" style={{color: 'var(--primary-color)', fontWeight: '600'}}>{formatted} (Ongoing)</span>;
    }
    return <span style={{fontWeight: 500, color: 'var(--warning)'}}>{formatted}</span>;
  };

  const MapLink = ({ lat, lng }) => {
    const [address, setAddress] = useState('');

    useEffect(() => {
      if (!lat || !lng) return;
      const key = `${parseFloat(lat).toFixed(4)},${parseFloat(lng).toFixed(4)}`;
      if (addressCache[key]) {
        setAddress(addressCache[key]);
        return;
      }

      fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`)
        .then(res => res.json())
        .then(data => {
          let addrParts = [];
          if (data.locality) addrParts.push(data.locality);
          else if (data.city) addrParts.push(data.city);
          if (data.principalSubdivision) addrParts.push(data.principalSubdivision);
          
          const formatted = addrParts.join(', ');
          if (formatted) {
            addressCache[key] = formatted;
            setAddress(formatted);
          }
        })
        .catch(e => console.error(e));
    }, [lat, lng]);

    if (!lat || !lng) return <span>-</span>;
    const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <a href={url} target="_blank" rel="noreferrer" className="map-link">
          📍 View Map
        </a>
        {address && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{address}</span>}
      </div>
    );
  };

  const Badge = ({ type }) => {
    let className = 'badge ';
    let text = type;
    
    if (type === 'WORK_IN') { className += 'work-in'; text = 'WORK IN'; }
    else if (type === 'WORK_OUT') { className += 'work-out'; text = 'WORK OUT'; }
    else if (type === 'LEAVE') { className += 'leave'; text = 'LEAVE'; }
    else { className += 'visit'; }

    return <span className={className}>{text}</span>;
  };

  if (loading) {
    return (
      <div className="loader-container">
        <div className="spinner"></div>
        <p>Loading Dashboard...</p>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <header className="header">
        <div>
          <h1>JA Staff Central</h1>
          <p>Real-time Attendance, Visits & Analytics</p>
        </div>
      </header>

      <div className="summary-grid">
        <div className="glass-panel summary-card">
          <div className="summary-icon">👥</div>
          <div className="summary-content">
            <h3>Total Staff</h3>
            <div className="value">{staffList.length}</div>
          </div>
        </div>
        <div className="glass-panel summary-card">
          <div className="summary-icon">✅</div>
          <div className="summary-content">
            <h3>Present Today</h3>
            <div className="value">{presentToday}</div>
          </div>
        </div>
        <div className="glass-panel summary-card">
          <div className="summary-icon">🏪</div>
          <div className="summary-content">
            <h3>Active Visits</h3>
            <div className="value">{activeVisits}</div>
          </div>
        </div>
      </div>

      <div className="attendance-status-container glass-panel">
        <div className="status-column present">
          <h3>Present Today ({presentStaffNames.length})</h3>
          <div className="staff-tags">
             {presentStaffNames.length === 0 ? <span className="empty-text">No one is present</span> : 
               presentStaffNames.map(s => <span key={s.id} className="staff-tag present-tag">{s.name}</span>)}
          </div>
        </div>
        <div className="status-column absent">
          <h3>Absent Today ({absentStaffNames.length})</h3>
          <div className="staff-tags">
             {absentStaffNames.length === 0 ? <span className="empty-text">Everyone is present!</span> : 
               absentStaffNames.map(s => <span key={s.id} className="staff-tag absent-tag">{s.name}</span>)}
          </div>
        </div>
      </div>

      <div className="glass-panel">
        <div className="tabs-container">
          <div className="tabs">
            <button 
              className={`tab-button ${activeTab === 'analytics' ? 'active' : ''}`}
              onClick={() => setActiveTab('analytics')}
            >
              📊 Analytics
            </button>
            <button 
              className={`tab-button ${activeTab === 'attendance' ? 'active' : ''}`}
              onClick={() => setActiveTab('attendance')}
            >
              Attendance Logs
            </button>
            <button 
              className={`tab-button ${activeTab === 'visits' ? 'active' : ''}`}
              onClick={() => setActiveTab('visits')}
            >
              Visit Logs
            </button>
          </div>
          <button className="export-btn" onClick={handleExport}>
            📥 Download CSV Report
          </button>
        </div>

        {(activeTab === 'attendance' || activeTab === 'visits') && (
          <div className="filters-row">
            <span style={{color: 'var(--text-muted)', fontWeight: 600}}>Filters:</span>
            <select value={filterStaff} onChange={e => setFilterStaff(e.target.value)} className="glass-input select">
              <option value="ALL">All Staff Members</option>
              {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
              <span style={{color: 'var(--text-muted)', fontSize: '0.9rem'}}>From:</span>
              <input 
                type="date" 
                value={filterFromDate} 
                onChange={e => setFilterFromDate(e.target.value)} 
                className="glass-input" 
              />
            </div>
            <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
              <span style={{color: 'var(--text-muted)', fontSize: '0.9rem'}}>To:</span>
              <input 
                type="date" 
                value={filterToDate} 
                onChange={e => setFilterToDate(e.target.value)} 
                className="glass-input" 
              />
            </div>
            <button 
              onClick={() => { 
                setFilterStaff('ALL'); 
                const today = new Date().toISOString().split('T')[0];
                setFilterFromDate(today); 
                setFilterToDate(today);
              }} 
              className="clear-btn"
            >
              ✕ Reset
            </button>
          </div>
        )}

        <div className="table-container">
          {activeTab === 'analytics' && (
            <div className="analytics-wrapper">
              <div className="analytics-controls">
                <select 
                  value={analyticsMode} 
                  onChange={e => setAnalyticsMode(e.target.value)} 
                  className="glass-input select"
                >
                  <option value="monthly">Monthly Analysis</option>
                  <option value="daily">Daily Analysis</option>
                </select>

                {analyticsMode === 'daily' ? (
                  <input 
                    type="date" 
                    value={selectedDate} 
                    onChange={e => setSelectedDate(e.target.value)} 
                    className="glass-input"
                  />
                ) : (
                  <input 
                    type="month" 
                    value={selectedMonth} 
                    onChange={e => setSelectedMonth(e.target.value)} 
                    className="glass-input"
                  />
                )}
              </div>

              <div className="analytics-grid">
                
                <div className="chart-container">
                <h3 className="chart-title">Staff Performance (Hours & Visits)</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={staffStats}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff22" />
                    <XAxis dataKey="Staff Name" stroke="#94a3b8" />
                    <YAxis yAxisId="left" stroke="#94a3b8" />
                    <YAxis yAxisId="right" orientation="right" stroke="#f59e0b" />
                    <Tooltip contentStyle={{backgroundColor: '#1e293b', border: 'none', borderRadius: '8px'}} />
                    <Legend />
                    <Bar yAxisId="left" dataKey="Total Work Hours" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    <Bar yAxisId="left" dataKey="Total Visit Hours" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="Visited Shops" stroke="#f59e0b" strokeWidth={3} dot={{ r: 6 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div className="chart-container">
                <h3 className="chart-title">Attendance vs Leaves</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={activityData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="value"
                      label
                    >
                      {activityData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{backgroundColor: '#1e293b', border: 'none', borderRadius: '8px'}} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="chart-container full-width">
                <h3 className="chart-title">Shop Visits Summary</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={staffStats}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff22" />
                    <XAxis dataKey="Staff Name" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" />
                    <Tooltip contentStyle={{backgroundColor: '#1e293b', border: 'none', borderRadius: '8px'}} />
                    <Legend />
                    <Line type="monotone" dataKey="Visited Shops" stroke="#f59e0b" strokeWidth={3} dot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

            </div>
            </div>
          )}

          {activeTab === 'attendance' && (
            <table>
              <thead>
                <tr>
                  <th>Date & Time</th>
                  <th>Staff Member</th>
                  <th>Type</th>
                  <th>Reason (Leave)</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {filteredTableAttendance.length === 0 ? (
                  <tr><td colSpan="5" style={{textAlign: 'center', padding: '40px'}}>No logs found for the selected filters</td></tr>
                ) : (
                  filteredTableAttendance.map(log => (
                    <tr key={log.id}>
                      <td>{formatDate(log.timestamp)}</td>
                      <td style={{fontWeight: 600}}>{getStaffName(log.staff_id)}</td>
                      <td><Badge type={log.type} /></td>
                      <td style={{color: 'var(--warning)'}}>{log.reason || '-'}</td>
                      <td><MapLink lat={log.lat} lng={log.lng} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {activeTab === 'visits' && (
            <table>
              <thead>
                <tr>
                  <th>Staff Member</th>
                  <th>Shop Name</th>
                  <th>Time IN</th>
                  <th>Time OUT</th>
                  <th>Duration</th>
                  <th>Location IN</th>
                  <th>Location OUT</th>
                </tr>
              </thead>
              <tbody>
                {filteredTableVisits.length === 0 ? (
                  <tr><td colSpan="6" style={{textAlign: 'center', padding: '40px'}}>No visits found for the selected filters</td></tr>
                ) : (
                  filteredTableVisits.map(visit => (
                    <tr key={visit.id}>
                      <td style={{fontWeight: 600}}>{getStaffName(visit.staff_id)}</td>
                      <td>{visit.shop_name}</td>
                      <td>{formatDate(visit.time_in)}</td>
                      <td>{visit.time_out ? formatDate(visit.time_out) : <span className="badge visit">Ongoing</span>}</td>
                      <td><LiveDuration timeIn={visit.time_in} timeOut={visit.time_out} /></td>
                      <td><MapLink lat={visit.lat_in} lng={visit.lng_in} /></td>
                      <td><MapLink lat={visit.lat_out} lng={visit.lng_out} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <footer className="footer">
        DEVELOPED BY JANAKA SANJEEWA &copy; {new Date().getFullYear()} | JA STAFF
      </footer>
    </div>
  );
}

export default App;
