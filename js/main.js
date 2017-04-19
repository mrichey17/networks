function main()
{
  // parse the URL's query parameters into a dictionary
  var qs = (function(a) {
    if (a == "") return {};
    var b = {};
    for (var i = 0; i < a.length; ++i)
    {
        var p=a[i].split('=', 2);
        if (p.length == 1)
            b[p[0]] = "";
        else
            b[p[0]] = decodeURIComponent(p[1].replace(/\+/g, " "));
    }
    return b;
  })(window.location.search.substr(1).split('&'));

  // get the name of the requested dataset (will be undefined if not dataset was chosen)
  var dataset_name = qs["dataset"];

  // populate drop-down menu
  config["datasets"].forEach(function (ds) {
      $("#dataset_menu").append(`<a class="item" href="?dataset=${ds}">${ds}</div>`);
    });

  // if no dataset has been chosen, or if the chosen dataset is not valid
  if (dataset_name === undefined || ! config["datasets"].includes(dataset_name)) {
    // return so the rest of the main() function will not run
    return;
  }

  // from here down we can assume a valid dataset was chosen...

  // make an SVG node to do our rendering in
  var svg = d3.select("svg")
    .call(d3.zoom().on("zoom", on_zoom))
    .append("g");

  // create a force simulation to handle re-centering nodes after drag operations
  var simulation = d3.forceSimulation();

  // load the requested dataset
  d3.json("data/" + dataset_name, function (error, graph) {
    // if there was an error, just give up for now
    // TODO: add a helpful error message to the HTML body in this case
    if (error) throw error;

    var minX = 0, minY = 0, maxX = 0, maxY = 0;
    var scale = 1;
    var nodes = {}, neighbors = {};

    // calculate most negative X/Y coordinates of all nodes
    graph.nodes.forEach(function (n) {
      nodes[n.id] = n;
      n.y = -n.y;
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    });

    // move all nodes to positive X/Y graph quadrant, and scale to fit in 1024x1024 rectangle
    graph.nodes.forEach(function (n) {
      scale = Math.min(1024 / (maxX - minX), 1024 / (maxY - minY));
      n.x = (n.x - minX) * scale;
      n.y = (n.y - minY) * scale;
    });

    // update graph edges so they directly reference the nodes rather than containing just their names
    graph.edges.forEach(function (l) {
      l.source = nodes[l.source];
      l.target = nodes[l.target];
    });

    // calculte node neighbors
    graph.edges.forEach(function (l) {
      if (neighbors[l.source.id] === undefined) neighbors[l.source.id] = [];
      if (neighbors[l.target.id] === undefined) neighbors[l.target.id] = [];
      if (! neighbors[l.source.id].includes(l.target.id)) neighbors[l.source.id].push(l.target.id);
      if (! neighbors[l.target.id].includes(l.source.id)) neighbors[l.target.id].push(l.source.id);
    });

    // add all edges from dataset to SVG
    var edge = svg.append("g")
      .attr("class", "edges")
      .selectAll(".edge")
      .data(graph.edges)
      .enter()
      .append("g")
      .attr("class", "edge");

    // add lines to each edge group
    edge.append("line")
      //.attr("stroke-width", function (l) { return l.size * scale / 2; })
      .attr("x1", function (l) { return l.source.x; })
      .attr("y1", function (l) { return l.source.y; })
      .attr("x2", function (l) { return l.target.x; })
      .attr("y2", function (l) { return l.target.y; });

    // add all nodes from dataset to SVG
    var node = svg.append("g")
      .attr("class", "nodes")
      .selectAll(".node")
      .data(graph.nodes)
      .enter()
      .append("g")
      .attr("class", "node");

    // add edges to each node group
    node.append("circle")
      .attr("r", function (n) { return n.size * scale / 2; })
      .attr("fill", function (n) { return n.color; })
      .attr("cx", function (n) { return n.x; })
      .attr("cy", function (n) { return n.y; })
      .attr("id", function (n) { return "node-" + n.id; })
      .call(d3.drag()
        .on("start", on_drag_start)
        .on("drag", on_drag)
        .on("end", on_drag_end))
      .on("click", on_node_click)
      .on("mouseover", on_node_mouseenter)
      .on("mouseout", on_node_mouseexit);

    // add titles to each node circle
    node.selectAll("circle").append("title").text(function (d) { return d.label; });

    // add labels to each node group
    node.append("text")
      .text(function (d) { return d.label; })
      .attr("x", function (n) { return n.x + (n.size * scale / 2) + 3; })
      .attr("y", function (n) { return n.y + 4; });

    // add simulation forces that pull nodes to their baked-in positions with a high strength
    simulation.force("x", d3.forceX(function (n) { return n.x; }).strength(0.8));
    simulation.force("y", d3.forceY(function (n) { return n.y; }).strength(0.8));

    // setup simulation "tick" function to be called during force simulation
    simulation.nodes(graph.nodes).on("tick", on_tick);

    // callback functoin for d3 force simulations.
    function on_tick() {
      // repoint SVG edges to the simulated nodes
      edge.selectAll("line")
        .attr("x1", function(d) { return d.source.x; })
        .attr("y1", function(d) { return d.source.y; })
        .attr("x2", function(d) { return d.target.x; })
        .attr("y2", function(d) { return d.target.y; });

      // reposition SVG nodes to match simulated nodes
      node.selectAll("circle")
        .attr("cx", function(d) { return d.x; })
        .attr("cy", function(d) { return d.y; });

      // reposition SVG text to match simulated nodes
      node.selectAll("text")
        .attr("x", function (n) { return n.x + (n.size * scale / 2) + 3; })
        .attr("y", function (n) { return n.y + 4; });
    }

    var selectedNode = undefined;

    // callback for clicking on a node
    function on_node_click(n) {
      // ignore these events while dragging
      if (dragging) return;

      // set the node to be "selected " and draw it highlighted
      selectedNode = n;
      highlight_node(selectedNode);
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
      highlight_node(selectedNode);
    }

    // helper function to set a node's appearance to highlighted
    function highlight_node(n) {
      // for all the nodes, they are CSS styled as "active" only if they are the selected node
      d3.selectAll(".node").classed("active", function (x) { return n === x; });
      // for all the nodes, they are CSS styled as "neighbor" only if they are neighbors of the selected node
      d3.selectAll(".node").classed("neighbor", function (x) { return n != undefined && neighbors[n.id].includes(x.id); });
      // for all the edges, they are CSS styled as "active" if their source or target is the selected node
      d3.selectAll(".edge").classed("active", function (x) { return x.source === n || x.target === n; });
    }

    var dragging = false;

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
  });

  // callback for zoom operations on the SVG image
  function on_zoom() {
    // update the SVG element's "transform" to match D3's knowledge of the pan/zoom state
    svg.attr("transform", d3.event.transform);
  }
}
