// define available networks
var config = {
  "networks": [
    { "name": "Trivial", "file": "data/trivial.json", "node_scale": 1, "edge_scale": 1 },
    { "name": "G2 Customer vs OFAC - circle", "file": "data/Sample.json", "node_scale": 1, "edge_scale": 1/2 },
    { "name": "SURF Egos & Connections 1", "file": "data/surf1.json", "node_scale": 2, "edge_scale": 1/12 },
    { "name": "SURF Egos & Connections 2", "file": "data/surf2.json", "node_scale": 2, "edge_scale": 1/12 },
    { "name": "SURF Extended Network - Important Actors", "file": "data/surf3.json", "node_scale": 3, "edge_scale": 1/12 },
    { "name": "SURF Extended Network - Connectors", "file": "data/surf4.json", "node_scale": 3, "edge_scale": 1/12 },
  ]
};

// the raw query string provided by the web browser
var query_string = {};

// network model
var network_path = undefined;    // path specified in query_string
var network_config = undefined;  // config matching the supplied path
var node_scale = 1;              // node_scale from network config
var edge_scale = 1;              // edge_scale from network config
var scale = 1;
var network = undefined;         // raw, parsed JSON data
var neighbors = {};              // map from node to list of neighbor IDs
var nodes = {};                  // map of nodes by ID

// svg model
var svg = undefined;             // main SVG tag
var svg_edges = undefined;       // list of edges
var svg_nodes = undefined;       // list of nodes
var arrow_width = 8;             // width of edge arrow
var arrow_height = 6;            // length of edge arrow

// D3 force simulation
var zoom = undefined;
var simulation = undefined;

// node selection and dragging
var selected_node = undefined;   // the current selected node
var dragging = false;            // whether or not dragging is active

// called when the document is loaded
function main() {
  parse_query_string();
  setup_ui();

  network_config = config["networks"].find(function (n) { return n["file"] == network_path; });

  if (network_config != undefined) {
    node_scale = network_config["node_scale"];
    edge_scale = network_config["edge_scale"];

    setup_network();
  }
}

// parse the URL's query parameters into a dictionary
function parse_query_string() {
  var qs = window.location.search.substr(1).split('&');

  for (var i = 0; i < qs.length; ++i) {
    var parts = qs[i].split('=', 2);
    if (parts.length == 1)
      query_string[parts[0]] = "";
    else
      query_string[parts[0]] = decodeURIComponent(parts[1].replace(/\+/g, " "));
  }

  // get the name of the requested network (will be undefined if not network was chosen)
  network_path = query_string["network"];
}

// setup UI
function setup_ui() {
  // populate drop-down menu
  config["networks"].forEach(function (ds) {
      $("#networks_menu").append(`<a class="item" href="?network=${ds["file"]}">${ds["name"]}</div>`);
    });
}

// render the network to the SVG and setup all the callbacks
function setup_network() {
  zoom = d3.zoom();

  // get svg node
  svg = d3.select("#viewport");

  // setup edge markers
  svg.append("svg:defs").selectAll("marker")
    .data(["relates"])
    .enter().append("svg:marker")
    .attr("id", String)
    .attr("viewBox", "0 0 10 10")
    .attr("refX", 0)
    .attr("refY", 5)
    .attr("markerWidth", arrow_width)
    .attr("markerHeight", arrow_height)
    .attr("orient", "auto")
    .append("svg:path")
    .attr("d", "M 0 0 L 10 5 L 0 10 z");

  // load the requested network
  d3.json(network_config["file"], on_svg_loaded);

  // handle callback when svg is loaded
  function on_svg_loaded(error, the_network) {
    if (error) throw error;

    network = the_network;

    // node bounds
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    // calculate most negative X/Y coordinates of all nodes
    network.nodes.forEach(function (n) {
      nodes[n.id] = n;
      n.y = -n.y;
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    });

    // calculate shift and scale to center network in view
    var width = maxX - minX;
    var height = maxY - minY;
    var bounds = d3.select("svg").node().getBoundingClientRect();
    var shiftX = bounds.width / 2;
    var shiftY = bounds.height / 2;
    var middleX = minX + (width / 2);
    var middleY = minY + (height / 2);

    maxX = maxX - middleX;
    maxY = maxY - middleY;
    minX = minX - middleX;
    minY = minY - middleY;

    var possibleScaleTerms = [];
    if (maxX != 0) possibleScaleTerms.push(bounds.width / Math.abs(maxX));
    if (minX != 0) possibleScaleTerms.push(bounds.width / Math.abs(minX));
    if (maxY != 0) possibleScaleTerms.push(bounds.height / Math.abs(maxY));
    if (minY != 0) possibleScaleTerms.push(bounds.height / Math.abs(minY));

    if (possibleScaleTerms.length == 0) {
      scale = 0.45;
    } else {
      scale = Math.min.apply(null, possibleScaleTerms) * 0.45;
    }

    // update all the nodes positions to center everything
    network.nodes.forEach(function (n) {
      n.x = ((n.x - middleX) * scale) + shiftX;
      n.y = ((n.y - middleY) * scale) + shiftY;
      if (n.label === undefined || n.label.length == 0) n.label = "UNNAMED NODE";
    });

    // pre-calculate node radii
    network.nodes.forEach(function (n) {
      n.radius = Math.sqrt(n.size) * node_scale;
    });

    // setup zoom callback
    d3.select("svg").call(zoom).call(zoom.on("zoom", on_svg_zoom));

    // update network edges so they directly reference the nodes rather than containing just their names
    network.edges.forEach(function (e) {
      e.source = nodes[e.source];
      e.target = nodes[e.target];
      e.width = Math.sqrt(e.size) * edge_scale;
    });

    // pre-calculate edge widths
    network.edges.forEach(function (e) {
      e.width = Math.sqrt(e.size) * edge_scale;
    });

    // calculte node neighbors
    network.edges.forEach(function (l) {
      if (neighbors[l.source.id] === undefined) neighbors[l.source.id] = [];
      if (neighbors[l.target.id] === undefined) neighbors[l.target.id] = [];
      if (! neighbors[l.source.id].includes(l.target.id)) neighbors[l.source.id].push(l.target.id);
      if (! neighbors[l.target.id].includes(l.source.id)) neighbors[l.target.id].push(l.source.id);
    });

    // sort node neighbors by node name
    Object.keys(neighbors).forEach(function (k) {
      neighbors[k].sort(function (a, b) {
        var la = nodes[a].label;
        var lb = nodes[b].label;
        if (la > lb) return 1;
        if (lb > la) return -1;
        return 0;
      });
    });

    // add all edges from network to SVG
    svg_edges = svg.append("g")
      .attr("class", "edges")
      .selectAll(".edge")
      .data(network.edges)
      .enter()
      .append("g")
      .attr("class", "edge");

    // add lines to each edge group
    svg_edges.append("line")
      .attr("stroke-width", function (e) { return e.width; })
      .attr("x1", function (e) { return e.source.x; })
      .attr("y1", function (e) { return e.source.y; })
      .attr("x2", function (e) { return e.target.x; })
      .attr("y2", function (e) { return e.target.y; })
      .attr("marker-end", function (e) { return "url(#relates)"; });

    // add all nodes from network to SVG
    svg_nodes = svg.append("g")
      .attr("class", "nodes")
      .selectAll(".node")
      .data(network.nodes)
      .enter()
      .append("g")
      .attr("class", "node");

    // add edges to each node group
    svg_nodes.append("circle")
      .attr("r", function (n) { return n.radius; })
      .attr("fill", function (n) { return n.color; })
      .attr("cx", function (n) { return n.x; })
      .attr("cy", function (n) { return n.y; })
      .attr("id", function (n) { return "node-" + n.id; });

    setup_simulation();
    setup_drag_and_drop();
    setup_node_selection();
  }

  // callback for zoom operations on the SVG image
  function on_svg_zoom() {
    // update the SVG element's "transform" to match D3's knowledge of the pan/zoom state
    d3.select("#viewport").attr("transform", d3.zoomTransform(this));
  }
}

// configuration force simuation
function setup_simulation() {
  // create a force simulation to handle re-centering nodes after drag operations
  simulation = d3.forceSimulation();

  // add simulation forces that pull nodes to their baked-in positions with a high strength
  simulation.force("x", d3.forceX(function (n) { return n.x; }).strength(0.8));
  simulation.force("y", d3.forceY(function (n) { return n.y; }).strength(0.8));

  // setup simulation "tick" function to be called during force simulation
  simulation.nodes(network.nodes).on("tick", on_simulation_tick);

  // everything is already in the right place, so need to simulate now
  simulation.stop();
  on_simulation_tick();

  // callback functoin for d3 force simulations.
  function on_simulation_tick() {
    // repoint SVG edges to the simulated nodes
    svg_edges.selectAll("line")
      .attr("x1", function(e) { return e.source.x; })
      .attr("y1", function(e) { return e.source.y; })
      .attr("x2", function(e) {
        var dx = e.target.x - e.source.x;
        var dy = e.target.y - e.source.y;
        var d = Math.sqrt(dx*dx + dy*dy);
        var s = 1;
        if (d != 0) {
          s = 1 - ((Math.sqrt(e.target.size) * node_scale + (arrow_height * e.width)) / d);
        }
        return e.source.x + (dx * s);
      })
      .attr("y2", function(e) {
        var dx = e.target.x - e.source.x;
        var dy = e.target.y - e.source.y;
        var d = Math.sqrt(dx*dx + dy*dy);
        var s = 1;
        if (d != 0) {
          s = 1 - ((Math.sqrt(e.target.size) * node_scale + (arrow_height * e.width)) / d);
        }
        return e.source.y + (dy * s);
      });

    // reposition SVG nodes to match simulated nodes
    svg_nodes.selectAll("circle")
      .attr("cx", function(d) { return d.x; })
      .attr("cy", function(d) { return d.y; });
  }
}

// configuration DnD of nodes
function setup_drag_and_drop() {
  d3.selectAll(".node circle")
    .call(d3.drag()
      .on("start", on_drag_start)
      .on("drag", on_drag)
      .on("end", on_drag_end));

  // callback for beginning of node dragging
  function on_drag_start(d) {
    // if the simulation is currently steady-state, reactivate it
    if (!d3.event.active) simulation.alphaTarget(0.3).restart();
    // set drag force to be toward current mouse location
    d.fx = d.x;
    d.fy = d.y;
    // we are now dragging
    dragging = true;
  }

  // callback for ongoing node dragging
  function on_drag(d) {
    // set drag force to be toward current mouse location
    d.fx = d3.event.x;
    d.fy = d3.event.y;
  }

  // callback for end of node dragging
  function on_drag_end(d) {
    // allow the simulation to return to steady-state
    if (!d3.event.active) simulation.alphaTarget(0);
    // remove drag force towards mouse
    d.fx = null;
    d.fy = null;
    // we are no longer dragging
    dragging = false;
  }
}

// configuration node selection
function setup_node_selection() {
  // setup background click callback
  d3.select("svg").on("click", on_svg_click);

  // setup node callbacks
  d3.selectAll(".node circle")
    .on("click", on_node_click)
    .on("mouseover", on_node_mouseenter)
    .on("mouseout", on_node_mouseexit);

  // callback for clicking on svg background
  function on_svg_click(n) {
    // clear selection
    selected_node = undefined;
    highlight_node(selected_node);
  }

  // callback for clicking on a node
  function on_node_click(n) {
    // ignore these events while dragging
    if (dragging) return;

    // set the node to be "selected " and draw it highlighted
    selected_node = n;
    highlight_node(selected_node);
    d3.event.stopPropagation();
  }

  // callback for mouse entering the region of a node
  function on_node_mouseenter(n) {
    // ignore these events while dragging
    if (dragging) return;

    // highlight the node the mouse is over
    highlight_node(n);
  }

  // callback for mouse existing the region of a node
  function on_node_mouseexit(n) {
    // ignore these events while dragging
    if (dragging) return;

    // go back to highlighting the selected (clicked-on) node, if there is one
    highlight_node(selected_node);
  }

  // helper function to set a node's appearance to highlighted
  function highlight_node(n) {
    // show/hide card
    d3.select("#node_card").classed("visible", n != undefined);

    // update card information
    if (n != undefined) {
        d3.select("#node_card .header").text(`${n.label}`);
        d3.selectAll("#node_card .description p").remove();

        var ns = neighbors[n.id];
        if (ns === undefined) {
          d3.select("#node_card .sub.header").text("Neighbors");
          d3.select("#node_card .description").text("--");
        } else {
          d3.select("#node_card .sub.header").text(`Neighbors (${ns.length})`);
          ns.forEach(function (nn) {
            $("#node_card .description").append(`<p>${nodes[nn].label}</p>`);
          });
        }
    }

    // for all the nodes, they are CSS styled as "active" only if they are the selected node
    d3.selectAll(".node").classed("active", function (x) { return n === x; });
    // for all the nodes, they are CSS styled as "neighbor" only if they are neighbors of the selected node
    d3.selectAll(".node").classed("neighbor", function (x) { return n != undefined && neighbors[n.id].includes(x.id); });
    // for all the nodes, they are CSS styled as "inactive" only if they are neither active nor the a neighbor
    d3.selectAll(".node").classed("inactive", function (x) { return n != undefined && n != x && !neighbors[n.id].includes(x.id); });
    // for all the edges, they are CSS styled as "active" if their source or target is the selected node
    d3.selectAll(".edge").classed("active", function (x) { return x.source === n || x.target === n; });
    // for all the edges, they are CSS styled as "active" if their source or target is the selected node
    d3.selectAll(".edge").classed("inactive", function (x) { return n != undefined && x.source != n && x.target != n; });
  }
}
